'use strict';
// GitDeck git layer: wraps the git CLI. Plain Node, no Electron dependency,
// so it can be unit-tested with plain node and reused from the main process.
const { spawn } = require('child_process');

function run(repoPath, args) {
  return new Promise((resolve, reject) => {
    const p = spawn('git', ['-C', repoPath, ...args]);
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error('git ' + args.join(' ') + ' failed: ' + err.trim().slice(0, 600)));
    });
  });
}

const FIELD = '\x1f';

async function toplevel(startPath) {
  const out = await run(startPath, ['rev-parse', '--show-toplevel']);
  return out.trim();
}

async function hasHead(repoPath) {
  try { await run(repoPath, ['rev-parse', '--verify', 'HEAD']); return true; }
  catch { return false; }
}

// ---- status -------------------------------------------------------------
// Returns { staged:[], unstaged:[], untracked:[] } entries {path, x, y, oldPath}
async function status(repoPath) {
  const out = await run(repoPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const recs = out.split('\0');
  const staged = [], unstaged = [], untracked = [];
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    if (!rec) continue;
    const x = rec[0], y = rec[1];
    let p = rec.slice(3);
    let oldPath = null;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') { oldPath = recs[++i]; }
    const entry = { path: p, x, y, oldPath };
    if (x === '?' && y === '?') untracked.push(entry);
    else {
      if (x !== ' ') staged.push(entry);
      if (y !== ' ') unstaged.push(entry);
    }
  }
  return { staged, unstaged, untracked };
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

async function commit(repoPath, message) {
  if (!message || !message.trim()) throw new Error('Commit message is empty');
  await run(repoPath, ['commit', '-m', message]);
  return headInfo(repoPath);
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
  return run(repoPath, ['show', '--no-color', '--format=', hash]);
}

// ---- history ---------------------------------------------------------------
async function log(repoPath, limit = 900) {
  const fmt = ['%H', '%h', '%P', '%an', '%at', '%s', '%D'].join(FIELD);
  const out = await run(repoPath, ['log', '--all', '--topo-order', '--date-order', '--format=' + fmt, '-n', String(limit)]);
  const commits = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [hash, short, parents, authorName, timestamp, subject, refsRaw] = line.split(FIELD);
    const refs = [];
    let isHead = false;
    for (const r of (refsRaw || '').split(', ')) {
      if (!r) continue;
      if (r === 'HEAD') { isHead = true; continue; }
      if (r.startsWith('HEAD -> ')) { isHead = true; refs.push(r.slice(8)); continue; }
      refs.push(r.replace(/^origin\//, ''));
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
  const NL = String.fromCharCode(10);
  const TAB = String.fromCharCode(9);
  const out = await run(repoPath, ['remote', '-v']);
  const map = new Map();
  for (const line of out.split(NL)) {
    if (!line.trim()) continue;
    const parts = line.trim().split(' ').filter(Boolean);
    if (parts.length < 2) continue;
    const nameUrl = parts[0].split(TAB);
    const name = nameUrl[0];
    const url = nameUrl[1] || parts[1];
    const kind = parts[1] || '';
    if (!map.has(name)) map.set(name, { name, fetch: null, push: null });
    if (kind.indexOf('fetch') !== -1) map.get(name).fetch = url;
    if (kind.indexOf('push') !== -1) map.get(name).push = url;
  }
  return [...map.values()];
}

async function createBranch(repoPath, name, from) {
  await run(repoPath, ['branch', name, from || 'HEAD']);
}

async function switchBranch(repoPath, name) {
  await run(repoPath, ['switch', name]);
}

async function merge(repoPath, name) {
  await run(repoPath, ['merge', '--no-edit', name]);
}

async function deleteBranch(repoPath, name, force = false) {
  await run(repoPath, ['branch', force ? '-D' : '-d', name]);
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

async function pull(repoPath) {
  await run(repoPath, ['pull', '--no-edit']);
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
  run, toplevel, hasHead, status, stage, stageAll, unstage, unstageAll, commit,
  headInfo, diffWorking, diffStaged, commitMeta, commitDiff, log,
  currentBranch, branches, remotes, createBranch, switchBranch, merge,
  deleteBranch, upstreamOf, push, pull, aheadBehind,
};
