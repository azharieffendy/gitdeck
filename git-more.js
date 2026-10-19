'use strict';
// GitDeck git layer, part two: tags, remotes, reflog, multi-commit cherry-pick,
// commit templates, submodules, worktrees, LFS, safe file access for the editors,
// and interactive rebase. Plain Node, testable like git.js.
const fs = require('fs');
const path = require('path');
const g = require('./git.js');

const { run, FIELD, assertBranchName, assertHash } = g;
const MAX_EDIT_BYTES = 2 * 1024 * 1024;

async function gitDir(repoPath) {
  return path.resolve((await run(repoPath, ['rev-parse', '--absolute-git-dir'])).trim());
}

// ---- tags ----------------------------------------------------------------------
async function tags(repoPath) {
  const fmt = ['%(refname:short)', '%(objectname:short)', '%(*objectname:short)', '%(objecttype)',
    '%(contents:subject)', '%(creatordate:unix)'].join(FIELD);
  const out = await run(repoPath, ['for-each-ref', '--sort=-creatordate', '--format=' + fmt, 'refs/tags']);
  return out.split('\n').filter(Boolean).map((line) => {
    const [name, sha, peeled, type, subject, date] = line.split(FIELD);
    return { name, commit: peeled || sha, annotated: type === 'tag', subject, timestamp: parseInt(date, 10) * 1000 || 0 };
  });
}

// An annotated tag when a message is given, a lightweight one otherwise.
async function createTag(repoPath, name, target, message) {
  assertBranchName(name);
  if (target) assertHash(target);
  const msg = message && message.trim() ? ['-a', '-m', message.trim()] : [];
  await run(repoPath, ['tag', ...msg, '--end-of-options', name, target || 'HEAD']);
}

async function deleteTag(repoPath, name) {
  assertBranchName(name);
  await run(repoPath, ['tag', '-d', '--end-of-options', name]);
}

function assertRemoteName(name) {
  assertBranchName(name);
  if (name.includes('/')) throw new Error('Invalid remote name: ' + name);
}

async function pushTag(repoPath, remote, name) {
  assertRemoteName(remote);
  assertBranchName(name);
  await run(repoPath, ['push', remote, 'refs/tags/' + name]);
}

async function deleteRemoteTag(repoPath, remote, name) {
  assertRemoteName(remote);
  assertBranchName(name);
  await run(repoPath, ['push', remote, ':refs/tags/' + name]);
}

// ---- branches & remotes ----------------------------------------------------------
async function renameBranch(repoPath, oldName, newName) {
  assertBranchName(oldName);
  assertBranchName(newName);
  await run(repoPath, ['branch', '-m', '--end-of-options', oldName, newName]);
}

async function addRemote(repoPath, name, url) {
  assertRemoteName(name);
  if (typeof url !== 'string' || !url.trim() || url.startsWith('-') || /[\0-\x1f]/.test(url)) {
    throw new Error('Invalid remote URL');
  }
  await run(repoPath, ['remote', 'add', name, url.trim()]);
}

async function removeRemote(repoPath, name) {
  assertRemoteName(name);
  await run(repoPath, ['remote', 'remove', name]);
}

// ---- reflog ----------------------------------------------------------------------
async function reflog(repoPath, limit = 300) {
  let out;
  try {
    out = await run(repoPath, ['reflog', 'show', '-n', String(limit), '--format=' + ['%H', '%h', '%gd', '%gs', '%ct'].join(FIELD)]);
  } catch { return []; } // no commits yet
  return out.split('\n').filter(Boolean).map((line) => {
    const [hash, short, selector, subject, time] = line.split(FIELD);
    return { hash, short, selector, subject, timestamp: parseInt(time, 10) * 1000 };
  });
}

// ---- cherry-pick several commits -------------------------------------------------
// hashes in the order to apply (oldest first). Merge commits need a mainline per
// commit, so they are picked one at a time instead.
async function cherryPickMany(repoPath, hashes) {
  if (!Array.isArray(hashes) || !hashes.length) throw new Error('No commits selected');
  hashes.forEach(assertHash);
  const merges = (await run(repoPath, ['rev-list', '--no-walk', '--min-parents=2', ...hashes])).trim();
  if (merges) throw new Error('Merge commits cannot be cherry-picked together; pick them one at a time');
  await run(repoPath, ['cherry-pick', ...hashes]);
}

// ---- commit message template ------------------------------------------------------
// The configured commit.template with comment lines removed (GitDeck commits with
// -m, so git would keep them), or '' when none is set.
async function commitTemplate(repoPath) {
  let file;
  try { file = (await run(repoPath, ['config', '--path', '--get', 'commit.template'])).trim(); }
  catch { return ''; }
  if (!file) return '';
  try {
    const text = fs.readFileSync(path.resolve(repoPath, file), 'utf8').slice(0, 64 * 1024);
    return text.split(/\r?\n/).filter((l) => !l.startsWith('#')).join('\n').replace(/\s+$/, '');
  } catch (e) {
    throw new Error('Cannot read commit template ' + file + ': ' + e.message);
  }
}

// ---- submodules ------------------------------------------------------------------
const SUBMODULE_STATE = { ' ': 'ok', '-': 'uninitialized', '+': 'modified', U: 'conflict' };

async function submodules(repoPath) {
  const out = await run(repoPath, ['submodule', 'status', '--recursive']);
  const list = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^([ +\-U])([0-9a-f]+) (.+?)(?: \((.*)\))?$/);
    if (!m) continue;
    list.push({ path: m[3], sha: m[2], state: SUBMODULE_STATE[m[1]], describe: m[4] || '', abs: path.resolve(repoPath, m[3]) });
  }
  return list;
}

async function submoduleUpdate(repoPath, subPath) {
  await run(repoPath, ['submodule', 'update', '--init', '--recursive', ...(subPath ? ['--', subPath] : [])]);
}

// ---- worktrees -------------------------------------------------------------------
function parseWorktrees(text) {
  const list = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: path.resolve(line.slice(9)), head: null, branch: null, detached: false, bare: false, locked: false, prunable: false };
      list.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line === 'bare') cur.bare = true;
    else if (line.startsWith('locked')) cur.locked = true;
    else if (line.startsWith('prunable')) cur.prunable = true;
  }
  list.forEach((w, i) => { w.isMain = i === 0; });
  return list;
}

async function worktrees(repoPath) {
  return parseWorktrees(await run(repoPath, ['worktree', 'list', '--porcelain']));
}

// opts.newBranch: create this branch for the worktree; opts.branch: check out an existing one.
async function worktreeAdd(repoPath, dir, opts = {}) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Worktree folder must be an absolute path');
  if (opts.newBranch) assertBranchName(opts.newBranch);
  if (opts.branch) assertBranchName(opts.branch);
  await run(repoPath, ['worktree', 'add', ...(opts.newBranch ? ['-b', opts.newBranch] : []),
    '--', dir, ...(opts.branch ? [opts.branch] : [])]);
}

async function worktreeRemove(repoPath, dir, force) {
  const known = (await worktrees(repoPath)).find((w) => w.path === path.resolve(dir));
  if (!known || known.isMain) throw new Error('Not a removable worktree: ' + dir);
  await run(repoPath, ['worktree', 'remove', ...(force ? ['--force'] : []), '--', known.path]);
}

// ---- Git LFS ---------------------------------------------------------------------
async function lfsInfo(repoPath) {
  let version;
  try { version = (await run(repoPath, ['lfs', 'version'])).trim(); }
  catch { return { installed: false, version: null, patterns: [], files: [] }; }
  const files = [];
  for (const line of (await run(repoPath, ['lfs', 'ls-files', '--long'])).split('\n')) {
    const m = line.match(/^([0-9a-f]+) ([*-]) (.+)$/);
    if (m) files.push({ oid: m[1].slice(0, 12), present: m[2] === '*', path: m[3] });
  }
  const patterns = [];
  for (const line of (await run(repoPath, ['lfs', 'track'])).split('\n')) {
    const m = line.match(/^\s+(\S.*?) \((.+)\)$/);
    if (m) patterns.push({ pattern: m[1], source: m[2] });
  }
  return { installed: true, version, patterns, files };
}

async function lfsPull(repoPath) { await run(repoPath, ['lfs', 'pull']); }

// ---- working files (file editor and merge editor) ---------------------------------
// Resolve a repo-relative path, refusing anything outside the working tree, inside
// .git, or reached through a symbolic link.
function safeRepoPath(repoPath, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) throw new Error('Invalid file path');
  const root = fs.realpathSync(repoPath);
  const full = path.resolve(root, rel);
  const relOut = path.relative(root, full);
  if (!relOut || relOut.startsWith('..') || path.isAbsolute(relOut) || relOut.split(path.sep)[0] === '.git') {
    throw new Error('Path is outside the working tree: ' + rel);
  }
  if (fs.realpathSync(path.dirname(full)) !== path.dirname(full)) throw new Error('Path goes through a link: ' + rel);
  if (fs.existsSync(full) && fs.lstatSync(full).isSymbolicLink()) throw new Error('Refusing to edit a symbolic link: ' + rel);
  return full;
}

function readWorkingFile(repoPath, rel) {
  const full = safeRepoPath(repoPath, rel);
  const st = fs.statSync(full);
  if (!st.isFile()) throw new Error('Not a file: ' + rel);
  if (st.size > MAX_EDIT_BYTES) throw new Error('File is too large to edit here (' + st.size + ' bytes)');
  const buf = fs.readFileSync(full);
  if (buf.includes(0)) throw new Error('Binary file cannot be edited here');
  return buf.toString('utf8');
}

// Only existing files are written: the editors change content, they do not create files.
function writeWorkingFile(repoPath, rel, content) {
  if (typeof content !== 'string') throw new Error('Content must be text');
  if (Buffer.byteLength(content) > MAX_EDIT_BYTES) throw new Error('Content is too large');
  const full = safeRepoPath(repoPath, rel);
  if (!fs.statSync(full).isFile()) throw new Error('Not a file: ' + rel);
  fs.writeFileSync(full, content);
}

async function saveResolved(repoPath, rel, content) {
  writeWorkingFile(repoPath, rel, content);
  await run(repoPath, ['add', '--', rel]);
}

// Rewrite a conflicted file's markers in diff3 style (adds the common base).
// Overwrites edits made to that file since the conflict.
async function conflictWithBase(repoPath, rel) {
  safeRepoPath(repoPath, rel);
  await run(repoPath, ['checkout', '--conflict=diff3', '--', rel]);
}

// ---- interactive rebase ------------------------------------------------------------
// git runs GIT_SEQUENCE_EDITOR / GIT_EDITOR through a shell with the file to edit as
// the last argument. Both point at editor/editor.js, which copies the prepared todo
// list, and answers each message prompt from a queue (null keeps git's message).
const EDITOR = path.join(__dirname, 'editor', 'editor.js');
const REBASE_ACTIONS = new Set(['pick', 'reword', 'squash', 'fixup', 'drop']);
const TODO_FILE = 'gitdeck-rebase-todo', MSGS_FILE = 'gitdeck-rebase-msgs.json';
const shPath = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);

function editorEnv(dir) {
  const cmd = (mode) => 'ELECTRON_RUN_AS_NODE=1 "$GITDECK_NODE" "$GITDECK_EDITOR" ' + mode;
  return {
    GIT_SEQUENCE_EDITOR: cmd('seq'), GIT_EDITOR: cmd('msg'),
    GITDECK_NODE: shPath(process.execPath), GITDECK_EDITOR: shPath(EDITOR),
    GITDECK_TODO: path.join(dir, TODO_FILE), GITDECK_MSGS: path.join(dir, MSGS_FILE),
  };
}

// Commits a rebase onto base would replay (oldest first). base null: from the root.
async function rebaseCommits(repoPath, base) {
  if (base) assertHash(base);
  const out = await run(repoPath, ['log', '--reverse', '--topo-order', '--no-merges',
    '--format=' + ['%H', '%h', '%an', '%s'].join(FIELD), base ? base + '..HEAD' : 'HEAD']);
  return out.split('\n').filter(Boolean).map((line) => {
    const [hash, short, authorName, subject] = line.split(FIELD);
    return { hash, short, authorName, subject };
  });
}

// The message queue in the order git asks: a reword at its pick, a squash chain once
// at its end (a fixup-only chain keeps the first message without asking).
function rebasePlan(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('Nothing to rebase');
  const kept = [];
  for (const s of steps) {
    if (!s || !REBASE_ACTIONS.has(s.action)) throw new Error('Unknown rebase action');
    assertHash(s.hash);
    if (s.message != null && typeof s.message !== 'string') throw new Error('Invalid message');
    if (s.action !== 'drop') kept.push(s);
  }
  if (!kept.length) throw new Error('A rebase must keep at least one commit');
  if (kept[0].action === 'squash' || kept[0].action === 'fixup') throw new Error('The first kept commit cannot be squashed or fixed up');
  const queue = [];
  let chain = null; // {squash: bool, message}
  const closeChain = () => { if (chain && chain.squash) queue.push(chain.message); chain = null; };
  for (const s of kept) {
    if (s.action === 'squash' || s.action === 'fixup') {
      chain = chain || { squash: false, message: null };
      if (s.action === 'squash') { chain.squash = true; if (s.message != null) chain.message = s.message; }
      continue;
    }
    closeChain();
    if (s.action === 'reword') queue.push(s.message != null ? s.message : null);
  }
  closeChain();
  const todo = steps.map((s) => s.action + ' ' + s.hash).join('\n') + '\n';
  return { todo, queue };
}

function cleanupRebase(dir) {
  for (const f of [TODO_FILE, MSGS_FILE]) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* not there */ } }
}

async function rebaseInteractive(repoPath, base, steps) {
  if (base) assertHash(base);
  const { todo, queue } = rebasePlan(steps);
  const dir = await gitDir(repoPath);
  fs.writeFileSync(path.join(dir, TODO_FILE), todo);
  fs.writeFileSync(path.join(dir, MSGS_FILE), JSON.stringify(queue));
  try {
    await run(repoPath, ['rebase', '-i', base || '--root'], { env: editorEnv(dir) });
  } catch (e) {
    // Stopped on a conflict: keep the queue for "continue". Otherwise clean up.
    if (!(await g.operationInProgress(repoPath))) cleanupRebase(dir);
    throw e;
  }
  cleanupRebase(dir);
}

// Continue / abort that keep answering queued rebase messages.
async function continueOperation(repoPath, op) {
  if (op !== 'rebase') return g.continueOperation(repoPath, op);
  const dir = await gitDir(repoPath);
  if (!fs.existsSync(path.join(dir, MSGS_FILE))) return g.continueOperation(repoPath, op);
  try { await run(repoPath, ['rebase', '--continue'], { env: editorEnv(dir) }); }
  finally { if (!(await g.operationInProgress(repoPath))) cleanupRebase(dir); }
}

async function abortOperation(repoPath, op) {
  await g.abortOperation(repoPath, op);
  if (op === 'rebase') cleanupRebase(await gitDir(repoPath));
}

module.exports = {
  gitDir, tags, createTag, deleteTag, pushTag, deleteRemoteTag,
  renameBranch, addRemote, removeRemote, reflog, cherryPickMany, commitTemplate,
  submodules, submoduleUpdate, parseWorktrees, worktrees, worktreeAdd, worktreeRemove,
  lfsInfo, lfsPull, safeRepoPath, readWorkingFile, writeWorkingFile, saveResolved, conflictWithBase,
  rebaseCommits, rebasePlan, rebaseInteractive, continueOperation, abortOperation,
};
