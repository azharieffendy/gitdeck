'use strict';
// GitDeck GitHub integration: pull requests for a repository whose remote is on
// github.com. Runs in the main process; the token never reaches the renderer.
// The token comes from GITHUB_TOKEN / GH_TOKEN, or from git's own credential store
// (the same credential git uses to push over HTTPS). Without one, public data still works.
const g = require('./git.js');

const API = 'https://api.github.com';
const TIMEOUT_MS = 15000;

// -> {owner, repo} for a github.com remote URL, else null.
function parseGitHubRemote(url) {
  const m = String(url || '').trim().match(
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function findRemote(repoPath) {
  const remotes = await g.remotes(repoPath);
  const ordered = [...remotes.filter((r) => r.name === 'origin'), ...remotes.filter((r) => r.name !== 'origin')];
  for (const r of ordered) {
    const gh = parseGitHubRemote(r.fetch || r.push);
    if (gh) return Object.assign({ remote: r.name }, gh);
  }
  throw new Error('No github.com remote in this repository');
}

// Ask git's credential helpers, without ever prompting (no askpass, no terminal, no GCM UI).
async function token(repoPath) {
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  try {
    const out = await g.run(repoPath, ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      env: { GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
    const m = out.match(/^password=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

async function request(repoPath, method, apiPath, body) {
  const tok = await token(repoPath);
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'GitDeck', 'X-GitHub-Api-Version': '2022-11-28' };
  if (tok) headers.Authorization = 'Bearer ' + tok;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + apiPath, {
    method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const why = (data && data.message) || res.statusText;
    const hint = !tok && (res.status === 401 || res.status === 403 || res.status === 404)
      ? ' (not signed in: push once over HTTPS so git stores a credential, or set GITHUB_TOKEN)' : '';
    throw new Error('GitHub: ' + why + hint);
  }
  return data;
}

const pullSummary = (p) => ({
  number: p.number, title: p.title, state: p.merged_at ? 'merged' : p.state, draft: !!p.draft,
  author: p.user && p.user.login, head: p.head && p.head.ref, base: p.base && p.base.ref,
  updated: p.updated_at, url: p.html_url,
});

async function info(repoPath) {
  const r = await findRemote(repoPath);
  const repo = await request(repoPath, 'GET', '/repos/' + r.owner + '/' + r.repo);
  return { owner: r.owner, repo: r.repo, remote: r.remote, defaultBranch: repo.default_branch, url: repo.html_url };
}

async function listPulls(repoPath, state) {
  const r = await findRemote(repoPath);
  const s = ['open', 'closed', 'all'].includes(state) ? state : 'open';
  const list = await request(repoPath, 'GET', '/repos/' + r.owner + '/' + r.repo + '/pulls?per_page=50&state=' + s);
  return list.map(pullSummary);
}

function assertNumber(n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('Invalid pull request number');
}

async function getPull(repoPath, number) {
  assertNumber(number);
  const r = await findRemote(repoPath);
  const base = '/repos/' + r.owner + '/' + r.repo;
  const [p, comments] = await Promise.all([
    request(repoPath, 'GET', base + '/pulls/' + number),
    request(repoPath, 'GET', base + '/issues/' + number + '/comments?per_page=50'),
  ]);
  return Object.assign(pullSummary(p), {
    body: p.body || '', commits: p.commits, additions: p.additions, deletions: p.deletions, changedFiles: p.changed_files,
    mergeable: p.mergeable,
    comments: comments.map((c) => ({ author: c.user && c.user.login, body: c.body || '', created: c.created_at })),
  });
}

async function createPull(repoPath, opts) {
  const o = opts || {};
  if (!o.title || !String(o.title).trim()) throw new Error('A pull request needs a title');
  g.assertBranchName(o.head);
  g.assertBranchName(o.base);
  const r = await findRemote(repoPath);
  const p = await request(repoPath, 'POST', '/repos/' + r.owner + '/' + r.repo + '/pulls', {
    title: String(o.title).trim(), body: String(o.body || ''), head: o.head, base: o.base, draft: !!o.draft,
  });
  return pullSummary(p);
}

// Fetch the pull request's head into local branch pr-<n> and switch to it.
async function checkoutPull(repoPath, number) {
  assertNumber(number);
  const r = await findRemote(repoPath);
  const branch = 'pr-' + number;
  if ((await g.currentBranch(repoPath)) === branch) throw new Error('Already on ' + branch + '; pull to update it');
  await g.run(repoPath, ['fetch', r.remote, '+refs/pull/' + number + '/head:refs/heads/' + branch]);
  await g.switchBranch(repoPath, branch);
  return branch;
}

const isGitHubUrl = (url) => typeof url === 'string' && /^https:\/\/github\.com\/[\w./?=&#%-]*$/.test(url);

module.exports = { parseGitHubRemote, info, listPulls, getPull, createPull, checkoutPull, isGitHubUrl };
