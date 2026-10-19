'use strict';
// GitDeck git layer: wraps the git CLI. Plain Node, no Electron dependency,
// so it can be unit-tested with plain node and reused from the main process.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Same behavior on Windows and Linux: never block on a terminal credential prompt
// (there is no TTY), and emit non-ASCII paths verbatim instead of octal-quoted.
// Credentials are asked through GIT_ASKPASS instead (see askpass/server.js).
const GIT_ENV = Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' });
const GIT_PREFIX = ['-c', 'core.quotepath=false'];
let askpassEnv = {};
let gitExe = 'git';

// env from askpass/server.js; git and ssh call the helper only when they need a credential.
function configureAskpass(env) { askpassEnv = Object.assign({}, env || {}); }

// Use a specific git executable instead of the one on PATH ('' restores PATH lookup).
function configureGit(exe) {
  if (exe && (typeof exe !== 'string' || !path.isAbsolute(exe))) throw new Error('Git path must be absolute');
  gitExe = exe || 'git';
}

// opts.input: text written to stdin. opts.env: extra environment for this call.
function run(repoPath, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, GIT_ENV, askpassEnv, opts.env || {});
    const p = spawn(gitExe, [...GIT_PREFIX, '-C', repoPath, ...args], { env, windowsHide: true });
    // Collect raw buffers so multi-byte UTF-8 characters split across chunks survive.
    const out = [], err = [];
    p.stdout.on('data', (d) => { out.push(d); });
    p.stderr.on('data', (d) => { err.push(d); });
    p.stdin.on('error', () => {}); // git may exit before reading stdin; the exit code reports it
    p.stdin.end(opts.input == null ? undefined : opts.input);
    p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(gitExe === 'git' ? 'git executable not found on PATH' : 'git executable not found: ' + gitExe) : e));
    p.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error('git ' + args.join(' ') + ' failed: ' + Buffer.concat(err).toString('utf8').trim().slice(0, 600)));
    });
  });
}

const FIELD = '\x1f';
const UNMERGED = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

// Reject user-supplied names/revisions that git could parse as options.
function assertBranchName(name) {
  if (typeof name !== 'string' || !name || name.startsWith('-') || /[\s~^:?*[\\]|\.\.|@\{/.test(name)) {
    throw new Error('Invalid branch name: ' + name);
  }
}
function assertHash(hash) {
  if (typeof hash !== 'string' || !/^[0-9a-f]{4,64}$/i.test(hash)) throw new Error('Invalid commit hash');
}

async function toplevel(startPath) {
  const out = await run(startPath, ['rev-parse', '--show-toplevel']);
  // git prints C:/x on Windows; normalize to the platform's native form.
  return path.resolve(out.trim());
}

async function hasHead(repoPath) {
  try { await run(repoPath, ['rev-parse', '--verify', 'HEAD']); return true; }
  catch { return false; }
}

// ---- clone -------------------------------------------------------------------
// Reject URLs or local paths that git could parse as an option.
function assertCloneUrl(url) {
  if (typeof url !== 'string' || !url.trim() || url.trim().startsWith('-')) {
    throw new Error('Invalid repository URL: ' + url);
  }
}

// Clone url into an absolute target folder (git creates it; its parent must
// exist) and return the new repository's toplevel path.
async function clone(url, dir) {
  assertCloneUrl(url);
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('The clone folder must be an absolute path');
  await run(path.dirname(dir), ['clone', '--', url.trim(), dir]);
  return toplevel(dir);
}

// ---- status -------------------------------------------------------------
// Returns { staged:[], unstaged:[], untracked:[], conflicted:[] } entries {path, x, y, oldPath}
async function status(repoPath) {
  const out = await run(repoPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const recs = out.split('\0');
  const staged = [], unstaged = [], untracked = [], conflicted = [];
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (!rec) continue;
    const x = rec[0], y = rec[1];
    let p = rec.slice(3);
    let oldPath = null;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') { oldPath = recs[++i]; }
    const entry = { path: p, x, y, oldPath };
    if (x === '?' && y === '?') untracked.push(entry);
    else if (UNMERGED.has(x + y)) conflicted.push(entry);
    else {
      if (x !== ' ') staged.push(entry);
      if (y !== ' ') unstaged.push(entry);
    }
  }
  return { staged, unstaged, untracked, conflicted };
}

async function stage(repoPath, paths) {
  if (!paths.length) return;
  await run(repoPath, ['add', '--', ...paths]);
}

async function stageAll(repoPath) {
  await run(repoPath, ['add', '-A']);
}

async function unstage(repoPath, paths) {
  if (!paths.length) return;
  if (await hasHead(repoPath)) {
    await run(repoPath, ['reset', '-q', 'HEAD', '--', ...paths]);
  } else {
    // No commits yet: remove from the index instead.
    await run(repoPath, ['rm', '-r', '--cached', '--quiet', '--', ...paths]);
  }
}

async function unstageAll(repoPath) {
  const st = await status(repoPath);
  const paths = [...new Set([...st.staged, ...st.staged.map((e) => e.oldPath)].filter(Boolean))];
  if (paths.length) await unstage(repoPath, paths);
}

async function commit(repoPath, message, opts = {}) {
  if (!message || !message.trim()) throw new Error('Commit message is empty');
  await run(repoPath, ['commit', ...(opts.amend ? ['--amend'] : []), '-m', message]);
  return headInfo(repoPath);
}

async function lastCommitMessage(repoPath) {
  if (!(await hasHead(repoPath))) return '';
  return (await run(repoPath, ['log', '-1', '--format=%B'])).trim();
}

// Apply a patch (e.g. one hunk) to the index (cached) or the working tree; reverse undoes it.
async function applyPatch(repoPath, patch, opts = {}) {
  const args = ['apply', '--whitespace=nowarn'];
  if (opts.cached) args.push('--cached');
  if (opts.reverse) args.push('--reverse');
  await run(repoPath, [...args, '-'], { input: patch });
}

// Throw away working-tree changes to tracked paths, and delete untracked ones.
async function discard(repoPath, paths, untracked = []) {
  if (paths.length) await run(repoPath, ['checkout', '--', ...paths]);
  if (untracked.length) await run(repoPath, ['clean', '-f', '-q', '--', ...untracked]);
}

async function headInfo(repoPath) {
  try {
    const out = await run(repoPath, ['log', '-1', '--format=' + ['%H', '%h', '%s'].join(FIELD)]);
    const [hash, short, subject] = out.trim().split(FIELD);
    return { hash, short, subject };
  } catch { return null; }
}

// ---- diffs ---------------------------------------------------------------
async function diffWorking(repoPath, path) {
  const args = ['diff', '--no-color'];
  if (path) args.push('--', path);
  return run(repoPath, args);
}

async function diffStaged(repoPath, path) {
  const args = ['diff', '--no-color', '--cached'];
  if (path) args.push('--', path);
  return run(repoPath, args);
}

async function commitMeta(repoPath, hash) {
  assertHash(hash);
  const out = await run(repoPath, ['show', '-s', '--format=' + ['%H', '%an', '%ae', '%at', '%P', '%B'].join(FIELD), hash]);
  const [full, authorName, authorEmail, timestamp, parents, ...rest] = out.trim().split(FIELD);
  return {
    hash: full, authorName, authorEmail,
    date: new Date(parseInt(timestamp, 10) * 1000).toISOString(),
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    message: rest.join(FIELD).trim(),
  };
}

async function commitDiff(repoPath, hash) {
  assertHash(hash);
  return run(repoPath, ['show', '--no-color', '--format=', hash]);
}

// ---- history ---------------------------------------------------------------
// One decoration from `%D` with --decorate=full -> {name, kind} or null for HEAD.
function parseRef(full) {
  if (full.startsWith('tag: refs/tags/')) return { name: full.slice('tag: refs/tags/'.length), kind: 'tag' };
  if (full.startsWith('refs/heads/')) return { name: full.slice('refs/heads/'.length), kind: 'local' };
  if (full.startsWith('refs/remotes/')) return { name: full.slice('refs/remotes/'.length), kind: 'remote' };
  return { name: full, kind: 'other' };
}

async function log(repoPath, limit = 900) {
  const fmt = ['%H', '%h', '%P', '%an', '%at', '%s', '%D'].join(FIELD);
  const out = await run(repoPath, ['log', '--all', '--topo-order', '--decorate=full', '--format=' + fmt, '-n', String(limit)]);
  const commits = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [hash, short, parents, authorName, timestamp, subject, refsRaw] = line.split(FIELD);
    const refs = [];
    let isHead = false;
    for (const r of (refsRaw || '').split(', ')) {
      if (!r) continue;
      if (r === 'HEAD') { isHead = true; continue; }
      if (r.startsWith('HEAD -> ')) { isHead = true; refs.push(parseRef(r.slice(8))); continue; }
      if (r.endsWith('/HEAD')) continue; // refs/remotes/origin/HEAD is just an alias
      refs.push(parseRef(r));
    }
    commits.push({
      hash, short,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      authorName,
      timestamp: parseInt(timestamp, 10) * 1000,
      subject,
      refs, isHead,
    });
  }
  return commits;
}

// ---- branches & remotes -----------------------------------------------------
async function currentBranch(repoPath) {
  try {
    const out = await run(repoPath, ['symbolic-ref', '--short', 'HEAD']);
    return out.trim();
  } catch {
    const out = await run(repoPath, ['rev-parse', '--short', 'HEAD']);
    return '(detached ' + out.trim() + ')';
  }
}

async function branches(repoPath) {
  const NL = String.fromCharCode(10);
  const local = [], remote = [];
  const out = await run(repoPath, ['branch', '-a', '--verbose', '--no-abbrev', '--format=' + ['%(refname)', '%(objectname:short)', '%(upstream:short)', '%(HEAD)'].join(FIELD)]);
  for (const line of out.split(NL)) {
    if (!line.trim()) continue;
    const parts = line.split(FIELD);
    const ref = parts[0], sha = parts[1], upstream = parts[2], headMark = parts[3];
    const entry = { sha, upstream: upstream || null, isCurrent: headMark === '*' };
    if (ref.startsWith('refs/heads/')) local.push({ ...entry, name: ref.slice('refs/heads/'.length) });
    else if (ref.startsWith('refs/remotes/')) remote.push({ ...entry, name: ref.slice('refs/remotes/'.length) });
    // anything else (e.g. a detached HEAD row) is skipped
  }
  return { local, remote };
}

async function remotes(repoPath) {
  const out = await run(repoPath, ['remote', '-v']);
  const map = new Map();
  for (const line of out.split(/\r?\n/)) {
    // "<name>\t<url> (fetch|push)" — the URL may contain spaces (local Windows paths).
    const m = line.match(/^(\S+)\t(.*) \((fetch|push)\)$/);
    if (!m) continue;
    const [, name, url, kind] = m;
    if (!map.has(name)) map.set(name, { name, fetch: null, push: null });
    map.get(name)[kind] = url;
  }
  return [...map.values()];
}

async function createBranch(repoPath, name, from) {
  assertBranchName(name);
  if (from) assertBranchName(from);
  await run(repoPath, ['branch', '--end-of-options', name, from || 'HEAD']);
}

async function switchBranch(repoPath, name) {
  assertBranchName(name);
  await run(repoPath, ['switch', '--end-of-options', name]);
}

async function merge(repoPath, name) {
  assertBranchName(name);
  await run(repoPath, ['merge', '--no-edit', '--end-of-options', name]);
}

async function deleteBranch(repoPath, name, force = false) {
  assertBranchName(name);
  await run(repoPath, ['branch', force ? '-D' : '-d', '--end-of-options', name]);
}

// ---- push / pull -------------------------------------------------------------
async function upstreamOf(repoPath, branch) {
  try {
    const out = await run(repoPath, ['rev-parse', '--abbrev-ref', branch + '@{upstream}']);
    return out.trim();
  } catch { return null; }
}

async function push(repoPath) {
  const branch = await currentBranch(repoPath);
  if (branch.startsWith('(detached')) throw new Error('HEAD is detached; switch to a branch before pushing');
  const up = await upstreamOf(repoPath, branch);
  let remoteName = null;
  if (up) {
    await run(repoPath, ['push']);
    remoteName = up.slice(0, up.indexOf('/') !== -1 ? up.indexOf('/') : up.length);
  } else {
    const rem = await remotes(repoPath);
    if (!rem.length) throw new Error('No remote configured');
    remoteName = rem[0].name;
    await run(repoPath, ['push', '-u', remoteName, branch]);
  }
  return { branch, upstream: up || remoteName + '/' + branch };
}

// opts.rebase: replay local commits on top of the upstream instead of merging.
async function pull(repoPath, opts = {}) {
  await run(repoPath, ['pull', ...(opts.rebase ? ['--rebase'] : ['--no-edit'])]);
}

async function fetch(repoPath) {
  await run(repoPath, ['fetch', '--all', '--prune']);
}

// ---- stash -----------------------------------------------------------------
function assertStashRef(ref) {
  if (typeof ref !== 'string' || !/^stash@\{\d+\}$/.test(ref)) throw new Error('Invalid stash reference');
}

async function stashList(repoPath) {
  const out = await run(repoPath, ['stash', 'list', '--format=' + ['%gd', '%H', '%at', '%gs'].join(FIELD)]);
  return out.split('\n').filter(Boolean).map((line) => {
    const [ref, hash, timestamp, subject] = line.split(FIELD);
    return { ref, hash, timestamp: parseInt(timestamp, 10) * 1000, subject };
  });
}

// paths: stash only these files (all changes when empty).
async function stashSave(repoPath, message, includeUntracked, paths = []) {
  const args = ['stash', 'push'];
  if (includeUntracked) args.push('--include-untracked');
  if (message && message.trim()) args.push('-m', message.trim());
  if (paths.length) args.push('--', ...paths);
  await run(repoPath, args);
}

async function stashApply(repoPath, ref) { assertStashRef(ref); await run(repoPath, ['stash', 'apply', ref]); }
async function stashPop(repoPath, ref) { assertStashRef(ref); await run(repoPath, ['stash', 'pop', ref]); }
async function stashDrop(repoPath, ref) { assertStashRef(ref); await run(repoPath, ['stash', 'drop', ref]); }
async function stashDiff(repoPath, ref) {
  assertStashRef(ref);
  return run(repoPath, ['stash', 'show', '-p', '--no-color', ref]);
}

// ---- cherry-pick / revert / in-progress operations ----------------------------
async function cherryPick(repoPath, hash) {
  assertHash(hash);
  const meta = await commitMeta(repoPath, hash);
  // A merge commit must name the mainline parent; the first parent is the usual choice.
  await run(repoPath, ['cherry-pick', ...(meta.parents.length > 1 ? ['-m', '1'] : []), hash]);
}

async function revert(repoPath, hash) {
  assertHash(hash);
  const meta = await commitMeta(repoPath, hash);
  await run(repoPath, ['revert', '--no-edit', ...(meta.parents.length > 1 ? ['-m', '1'] : []), hash]);
}

const OP_MARKERS = [
  ['rebase', 'rebase-merge'], ['rebase', 'rebase-apply'],
  ['merge', 'MERGE_HEAD'], ['cherry-pick', 'CHERRY_PICK_HEAD'], ['revert', 'REVERT_HEAD'],
];

// The multi-step operation currently stopped in this repo, or null.
async function operationInProgress(repoPath) {
  const out = await run(repoPath, ['rev-parse', ...OP_MARKERS.flatMap(([, m]) => ['--git-path', m])]);
  const paths = out.split('\n').filter(Boolean);
  for (let i = 0; i < OP_MARKERS.length; i++) {
    if (paths[i] && fs.existsSync(path.resolve(repoPath, paths[i]))) return OP_MARKERS[i][0];
  }
  return null;
}

function assertOp(op) {
  if (!['merge', 'cherry-pick', 'revert', 'rebase'].includes(op)) throw new Error('Unknown operation: ' + op);
}

async function abortOperation(repoPath, op) {
  assertOp(op);
  await run(repoPath, [op, '--abort']);
}

// Continue after conflicts are resolved; keeps the prepared message (no editor).
async function continueOperation(repoPath, op) {
  assertOp(op);
  const noEditor = { env: { GIT_EDITOR: 'true' } };
  if (op === 'merge') await run(repoPath, ['commit', '--no-edit'], noEditor);
  else await run(repoPath, [op, '--continue'], noEditor);
}

// Resolve a conflicted file with one whole side, then mark it resolved.
async function resolveConflict(repoPath, file, side) {
  if (side !== 'ours' && side !== 'theirs') throw new Error('Side must be ours or theirs');
  await run(repoPath, ['checkout', '--' + side, '--', file]);
  await run(repoPath, ['add', '--', file]);
}

async function conflictDiff(repoPath, file) {
  return run(repoPath, ['diff', '--no-color', '--', file]);
}

// ---- blame -------------------------------------------------------------------
// Parse `git blame --porcelain` into one entry per line.
function parseBlame(text) {
  const commits = new Map();
  const lines = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const header = raw.match(/^([0-9a-f]{40,64}) (\d+) (\d+)/);
    if (header && !cur) {
      if (!commits.has(header[1])) commits.set(header[1], { hash: header[1] });
      cur = { commit: commits.get(header[1]), line: parseInt(header[3], 10) };
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('\t')) {
      const c = cur.commit;
      lines.push({
        line: cur.line, hash: c.hash, author: c.author || '', time: c.time || 0,
        summary: c.summary || '', text: raw.slice(1).replace(/\r$/, ''),
      });
      cur = null;
      continue;
    }
    const sp = raw.indexOf(' ');
    const key = sp === -1 ? raw : raw.slice(0, sp), val = sp === -1 ? '' : raw.slice(sp + 1);
    if (key === 'author') cur.commit.author = val;
    else if (key === 'author-time') cur.commit.time = parseInt(val, 10) * 1000;
    else if (key === 'summary') cur.commit.summary = val;
  }
  return lines;
}

// rev: blame the file as of that commit (a hash, optionally with ^ for its parent).
async function blame(repoPath, file, rev) {
  if (rev != null && (typeof rev !== 'string' || !/^[0-9a-f]{4,64}\^?$/i.test(rev))) throw new Error('Invalid revision');
  return parseBlame(await run(repoPath, ['blame', '--porcelain', ...(rev ? [rev] : []), '--', file]));
}

async function aheadBehind(repoPath) {
  const branch = await currentBranch(repoPath);
  const up = await upstreamOf(repoPath, branch);
  if (!up) return null;
  try {
    const out = await run(repoPath, ['rev-list', '--left-right', '--count', branch + '...' + up]);
    const [ahead, behind] = out.trim().split(/\s+/).map(Number);
    return { ahead, behind };
  } catch { return null; }
}

module.exports = {
  run, configureAskpass, configureGit, FIELD, assertBranchName, assertHash, toplevel, hasHead, clone, parseRef, status, stage, stageAll, unstage, unstageAll,
  commit, lastCommitMessage, applyPatch, discard,
  headInfo, diffWorking, diffStaged, commitMeta, commitDiff, log,
  currentBranch, branches, remotes, createBranch, switchBranch, merge,
  deleteBranch, upstreamOf, push, pull, fetch, aheadBehind,
  stashList, stashSave, stashApply, stashPop, stashDrop, stashDiff,
  cherryPick, revert, operationInProgress, abortOperation, continueOperation,
  resolveConflict, conflictDiff, parseBlame, blame,
};
