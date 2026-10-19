'use strict';
// GitDeck renderer app logic.
const $ = (sel) => document.querySelector(sel);
const state = {
  repo: null,
  view: 'worktree',
  branch: null,
  status: null,
  log: [],
  branchesData: null,
  remotesData: [],
  ab: null,
  selectedKey: null,
};

const esc = (s) => window.GitDiff.escapeHtml(String(s == null ? '' : s));

async function api(channel, payload) {
  const res = await window.gitdeck.invoke(channel, payload);
  if (!res || !res.ok) throw new Error((res && res.error) || 'Unknown error');
  return res.data;
}

let toastTimer = null;
function toast(msg, kind) {
  const bar = $('#statusbar');
  bar.textContent = msg;
  bar.className = 'statusbar ' + (kind || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { bar.textContent = ''; bar.className = 'statusbar'; }, 6000);
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function badgeFor(code) {
  const map = { M: ['mod', 'M'], A: ['add', 'A'], D: ['del', 'D'], R: ['ren', 'R'], C: ['cpy', 'C'], U: ['conflict', '!'], '?': ['untracked', '?'] };
  const m = map[code] || ['untracked', code];
  return '<span class="badge badge-' + m[0] + '">' + m[1] + '</span>';
}

function dirPart(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i + 1);
}
function basePart(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

// ---------- refresh ----------
async function refreshAll() {
  if (!state.repo) return;
  const data = await api('gd:refresh', { repo: state.repo });
  state.branch = data.branch;
  state.status = data.status;
  state.log = data.log;
  state.branchesData = data.branches;
  state.remotesData = data.remotes;
  state.ab = data.ab;

  $('#repo-name').textContent = state.repo;
  $('#repo-name').title = state.repo;
  $('#branch-pill').textContent = state.branch;
  const ab = state.ab;
  $('#ahead-behind').textContent = ab ? ('↓' + ab.behind + ' ↑' + ab.ahead) : '';
  const changes = state.status.staged.length + state.status.unstaged.length + state.status.untracked.length;
  $('#wt-count').textContent = changes > 0 ? String(changes) : '';
  $('#head-info').textContent = data.head ? (data.head.short + ' ' + data.head.subject) : 'no commits yet';

  renderView();
}

// ---------- views ----------
function setView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  renderView();
}

function renderView() {
  if (!state.repo) return;
  if (state.view === 'worktree') renderWorktree();
  else if (state.view === 'history') renderHistory();
  else renderBranches();
}

function detail(html) {
  $('#detail-pane').innerHTML = html;
}

// ---------- working tree ----------
function renderWorktree() {
  const st = state.status;
  let html = '';

  html += sectionHeader('Staged (' + st.staged.length + ')',
    st.staged.length ? '<button class="btn btn-sm" id="act-unstage-all">Unstage all</button>' : '');
  if (st.staged.length === 0) html += emptyRow('Nothing staged');
  for (const e of st.staged) {
    html += fileRow(e, 'staged', badgeFor(e.x), 'act-unstage');
  }

  html += sectionHeader('Changes (' + st.unstaged.length + ')',
    (st.unstaged.length + st.untracked.length) ? '<button class="btn btn-sm" id="act-stage-all">Stage all</button>' : '');
  if (st.unstaged.length === 0 && st.untracked.length === 0) html += emptyRow('Working tree clean');
  for (const e of st.unstaged) {
    html += fileRow(e, 'unstaged', badgeFor(e.y), 'act-stage');
  }
  for (const e of st.untracked) {
    html += fileRow(e, 'untracked', badgeFor('?'), 'act-stage');
  }

  html += '<div class="commit-box">' +
    '<textarea id="commit-msg" placeholder="Commit message"></textarea>' +
    '<div class="commit-row">' +
    '<span class="commit-hint" id="commit-hint">' + st.staged.length + ' file(s) staged</span>' +
    '<button class="btn btn-primary" id="act-commit" ' + (st.staged.length ? '' : 'disabled') + '>Commit</button>' +
    '</div></div>';

  $('#list-pane').innerHTML = html;
  wireCommon();

  const unstageAll = $('#act-unstage-all');
  if (unstageAll) unstageAll.onclick = () => act('gd:unstageAll', 'Unstaged all');
  const stageAll = $('#act-stage-all');
  if (stageAll) stageAll.onclick = () => act('gd:stageAll', 'Staged all');
  const commitBtn = $('#act-commit');
  if (commitBtn) commitBtn.onclick = doCommit;
}

function sectionHeader(title, actionsHtml) {
  return '<div class="section-header"><span>' + esc(title) + '</span><span class="actions">' + (actionsHtml || '') + '</span></div>';
}
function emptyRow(text) {
  return '<div class="row" style="cursor:default"><span class="path" style="color:var(--muted)">' + esc(text) + '</span></div>';
}
function fileRow(e, kind, badge, actionClass) {
  const key = kind + ':' + e.path;
  const sel = state.selectedKey === key ? ' selected' : '';
  const actionGlyph = actionClass === 'act-stage' ? '+' : '\u2212';
  const actionTitle = actionClass === 'act-stage' ? 'Stage' : 'Unstage';
  return '<div class="row' + sel + '" data-kind="' + kind + '" data-path="' + esc(e.path) + '">' +
    badge +
    '<span class="path"><span class="dir">' + esc(dirPart(e.path)) + '</span>' + esc(basePart(e.path)) +
    (e.oldPath ? ' <span style="color:var(--muted)">(from ' + esc(e.oldPath) + ')</span>' : '') + '</span>' +
    '<span class="row-actions"><button class="btn btn-sm ' + actionClass + '" data-path="' + esc(e.path) + '" title="' + actionTitle + '">' + actionGlyph + '</button></span>' +
    '</div>';
}

function wireCommon() {
  document.querySelectorAll('#list-pane .row[data-kind]').forEach((row) => {
    row.onclick = () => {
      state.selectedKey = (row.dataset.kind || '') + ':' + (row.dataset.path || '');
      document.querySelectorAll('#list-pane .row').forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      showFileDetail(row.dataset.kind, row.dataset.path);
    };
  });
  document.querySelectorAll('#list-pane .act-stage').forEach((b) => {
    b.onclick = (ev) => { ev.stopPropagation(); act('gd:stagePaths', 'Staged', { paths: [b.dataset.path] }); };
  });
  document.querySelectorAll('#list-pane .act-unstage').forEach((b) => {
    b.onclick = (ev) => { ev.stopPropagation(); act('gd:unstagePaths', 'Unstaged', { paths: [b.dataset.path] }); };
  });
}

async function showFileDetail(kind, path) {
  try {
    let diffText;
    let label;
    if (kind === 'staged') { diffText = await api('gd:diffStaged', { repo: state.repo, path }); label = 'Staged changes'; }
    else if (kind === 'unstaged') { diffText = await api('gd:diffWorking', { repo: state.repo, path }); label = 'Working tree changes'; }
    else {
      detail('<div class="detail-header"><span class="title">' + esc(path) + '</span><span class="badge badge-untracked">untracked</span></div>' +
        '<div class="diff-empty">New file, not yet in Git. Stage it to include it in the next commit.</div>');
      return;
    }
    detail('<div class="detail-header"><span class="title">' + esc(path) + '</span><span style="color:var(--muted)">' + esc(label) + '</span></div>' +
      window.GitDiff.render(diffText));
  } catch (e) { toast(e.message, 'error'); }
}

async function act(channel, okMsg, extra) {
  try {
    await api(channel, Object.assign({ repo: state.repo }, extra || {}));
    toast(okMsg, 'success');
    await refreshAll();
  } catch (e) { toast(e.message, 'error'); }
}

async function doCommit() {
  const msg = $('#commit-msg').value;
  if (!msg.trim()) { toast('Write a commit message first', 'error'); return; }
  try {
    const res = await api('gd:commit', { repo: state.repo, message: msg });
    toast('Committed ' + res.head.short, 'success');
    await refreshAll();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- history ----------
function renderHistory() {
  const commits = state.log;
  if (!commits.length) {
    $('#list-pane').innerHTML = '<div class="empty-state"><div class="empty-title">No commits yet</div>' +
      '<div class="empty-hint">Make your first commit from the Working Tree view.</div></div>';
    return;
  }
  const lay = window.GitGraph.layout(commits);
  let rows = '';
  commits.forEach((c) => {
    const sel = state.selectedKey === 'commit:' + c.hash ? ' selected' : '';
    let refs = '';
    if (c.isHead) refs += '<span class="ref-badge head">HEAD</span>';
    for (const r of c.refs) {
      const cls = r.indexOf('/') !== -1 ? 'remote' : (r.indexOf('tag: ') === 0 ? 'tag' : 'local');
      refs += '<span class="ref-badge ' + cls + '">' + esc(r.replace('tag: ', '')) + '</span>';
    }
    rows += '<div class="hrow' + sel + '" data-hash="' + c.hash + '">' +
      '<span class="subject">' + refs + esc(c.subject) + '</span>' +
      '<span></span>' +
      '<span class="author">' + esc(c.authorName) + '</span>' +
      '<span class="date">' + esc(fmtDate(c.timestamp)) + '</span>' +
      '</div>';
  });
  $('#list-pane').innerHTML =
    '<div class="section-header"><span>History (' + commits.length + ')</span></div>' +
    '<div class="history-wrap"><div class="graph-col">' + window.GitGraph.svg(lay) + '</div>' +
    '<div class="history-rows">' + rows + '</div></div>';

  document.querySelectorAll('#list-pane .hrow').forEach((row) => {
    row.onclick = () => {
      state.selectedKey = 'commit:' + row.dataset.hash;
      document.querySelectorAll('#list-pane .hrow').forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      showCommitDetail(row.dataset.hash);
    };
  });
}

async function showCommitDetail(hash) {
  try {
    const info = await api('gd:commitInfo', { repo: state.repo, hash });
    const m = info.meta;
    detail('<div class="detail-header"><span class="title">' + esc(m.hash.slice(0, 12)) + '</span></div>' +
      '<div class="detail-meta"><div class="msg">' + esc(m.message) + '</div>' +
      '<div class="byline">' + esc(m.authorName) + ' &lt;' + esc(m.authorEmail) + '&gt; &#183; ' + esc(fmtDate(Date.parse(m.date))) +
      ' &#183; parents: ' + (m.parents.length ? esc(m.parents.join(' ').slice(0, 24)) : 'root') + '</div></div>' +
      window.GitDiff.render(info.diff));
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- branches ----------
function renderBranches() {
  const b = state.branchesData || { local: [], remote: [] };
  let html = '<div class="branches-create">' +
    '<input id="new-branch" placeholder="new-branch-name" spellcheck="false">' +
    '<button class="btn" id="act-create-branch">Create</button></div>';

  html += sectionHeader('Local (' + b.local.length + ')', '');
  for (const br of b.local) {
    const cur = br.isCurrent ? ' <span class="ref-badge head">HEAD</span>' : '';
    const upstream = br.upstream ? ' <span style="color:var(--muted)">&#8594; ' + esc(br.upstream) + '</span>' : '';
    html += '<div class="row" style="cursor:default">' +
      '<span class="path">' + esc(br.name) + cur + upstream + '</span>' +
      '<span class="row-actions" style="opacity:1">' +
      (br.isCurrent ? '' : '<button class="btn btn-sm act-switch" data-name="' + esc(br.name) + '">Switch</button>' +
        '<button class="btn btn-sm act-merge" data-name="' + esc(br.name) + '">Merge</button>' +
        '<button class="btn btn-sm btn-danger act-delete" data-name="' + esc(br.name) + '">Delete</button>') +
      '</span></div>';
  }

  html += sectionHeader('Remote-tracking (' + b.remote.length + ')', '');
  if (!b.remote.length) html += emptyRow('No remote branches');
  for (const br of b.remote) {
    html += '<div class="row" style="cursor:default"><span class="path">' + esc(br.name) + '</span></div>';
  }

  html += sectionHeader('Remotes', '');
  if (!state.remotesData.length) html += emptyRow('No remotes configured');
  for (const r of state.remotesData) {
    html += '<div class="row" style="cursor:default; height:auto; min-height:32px; padding-top:4px; padding-bottom:4px;">' +
      '<span class="path"><div>' + esc(r.name) + '</div><div class="remote-url">' + esc(r.fetch || '') + '</div></span></div>';
  }

  $('#list-pane').innerHTML = html;

  const createBtn = $('#act-create-branch');
  createBtn.onclick = async () => {
    const name = $('#new-branch').value.trim();
    if (!name) { toast('Type a branch name first', 'error'); return; }
    try {
      await api('gd:createBranch', { repo: state.repo, name });
      await api('gd:switchBranch', { repo: state.repo, name });
      toast('Created and switched to ' + name, 'success');
      await refreshAll();
    } catch (e) { toast(e.message, 'error'); }
  };
  document.querySelectorAll('.act-switch').forEach((btn) => {
    btn.onclick = () => act('gd:switchBranch', 'Switched to ' + btn.dataset.name, { name: btn.dataset.name });
  });
  document.querySelectorAll('.act-merge').forEach((btn) => {
    btn.onclick = () => act('gd:merge', 'Merged ' + btn.dataset.name, { name: btn.dataset.name });
  });
  document.querySelectorAll('.act-delete').forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm('Delete branch ' + btn.dataset.name + '?')) return;
      await act('gd:deleteBranch', 'Deleted ' + btn.dataset.name, { name: btn.dataset.name });
    };
  });
}

// ---------- toolbar ----------
async function openDialog() {
  try {
    const top = await api('gd:openDialog', {});
    if (!top) return;
    state.repo = top;
    state.selectedKey = null;
    await refreshAll();
    toast('Opened ' + top, 'success');
  } catch (e) {
    toast(e.message + ' (is it a Git repository?)', 'error');
  }
}

function wireToolbar() {
  $('#btn-open').onclick = openDialog;
  $('#btn-open-2').onclick = openDialog;
  $('#btn-refresh').onclick = () => state.repo ? refreshAll() : null;
  $('#btn-pull').onclick = () => state.repo ? act('gd:pull', 'Pulled', {}) : null;
  $('#btn-push').onclick = () => state.repo ? act('gd:push', 'Pushed', {}) : null;
  $('#branch-pill').onclick = () => setView('branches');
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.onclick = () => setView(el.dataset.view);
  });
}

wireToolbar();

// Auto-open when launched with ?repo=<path> (GitDeck --path=...)
(function autoOpen() {
  try {
    const params = new URLSearchParams(window.location.search);
    const repo = params.get('repo');
    const view = params.get('view');
    if (view === 'history' || view === 'branches' || view === 'worktree') {
      state.view = view;
      document.querySelectorAll('.nav-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.view === view);
      });
    }
    if (repo) {
      state.repo = repo;
      refreshAll().catch((e) => toast(e.message + ' (is it a Git repository?)', 'error'));
    }
  } catch (_e) { /* ignore */ }
  document.title = 'GitDeck';
})();
