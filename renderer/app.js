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
  stashes: [],
  tags: [],
  op: null,
  ab: null,
  selectedKey: null,
  commitDraft: '',
  amend: false,
  diffMode: loadPref('diffMode', 'unified'),
  // Files currently shown in the detail pane (for hunk actions) and how to redraw it.
  detailFiles: [],
  redrawDetail: null,
  // History view: text filter, reflog mode, multi-selection (Ctrl / Shift click).
  historyFilter: '',
  showReflog: false,
  selectedCommits: [],
  anchorCommit: null,
};

const esc = (s) => window.GitDiff.escapeHtml(String(s == null ? '' : s));
const OP_LABELS = { merge: 'Merge', 'cherry-pick': 'Cherry-pick', revert: 'Revert', rebase: 'Rebase' };

function loadPref(key, fallback) {
  try { return window.localStorage.getItem('gitdeck.' + key) || fallback; } catch { return fallback; }
}
function savePref(key, value) {
  try { window.localStorage.setItem('gitdeck.' + key, value); } catch { /* preferences are optional */ }
}

async function api(channel, payload) {
  const res = await window.gitdeck.invoke(channel, payload);
  if (!res || !res.ok) throw new Error((res && res.error) || 'Unknown error');
  return res.data;
}

// Status bar message. Errors stay until dismissed or replaced; others fade after 6 s.
let toastTimer = null;
function toast(msg, kind, sticky) {
  const el = $('#status-msg');
  const clear = () => { el.textContent = ''; el.className = 'sb-msg'; $('#status-dismiss').hidden = true; };
  el.textContent = msg;
  el.className = 'sb-msg ' + (kind || '');
  $('#status-dismiss').hidden = kind !== 'error';
  $('#status-dismiss').onclick = clear;
  clearTimeout(toastTimer);
  if (!sticky && kind !== 'error') toastTimer = setTimeout(clear, 6000);
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
  state.stashes = data.stashes || [];
  state.tags = data.tags || [];
  state.op = data.op || null;
  state.ab = data.ab;

  $('#repo-name').textContent = state.repo;
  $('#repo-name').title = state.repo;
  $('#branch-name').textContent = state.branch;
  const ab = state.ab;
  $('#ahead-behind').textContent = ab ? ('↑' + ab.ahead + ' ↓' + ab.behind) : 'no upstream';
  const changes = state.status.staged.length + state.status.unstaged.length +
    state.status.untracked.length + state.status.conflicted.length;
  $('#wt-count').textContent = changes > 0 ? String(changes) : '';
  $('#stash-count').textContent = state.stashes.length ? String(state.stashes.length) : '';
  $('#head-info').textContent = data.head ? (data.head.short + ' ' + data.head.subject) : 'no commits yet';
  $('#tb-staged').textContent = state.status.staged.length ? String(state.status.staged.length) : '';
  $('#tb-ahead').textContent = ab && ab.ahead ? String(ab.ahead) : '';
  $('#tb-behind').textContent = ab && ab.behind ? String(ab.behind) : '';
  document.querySelectorAll('.needs-repo').forEach((b) => { b.disabled = false; });

  renderHistory();
  renderRefTree();
  renderView();
}

// ---------- views ----------
// The log has its own panel, so views only drive the list panel.
const VIEW_TITLES = { worktree: 'Files', branches: 'Branches and tags', stashes: 'Stashes', pulls: 'Pull requests', repository: 'Repository' };

function setView(view) {
  if (view === 'history') view = 'worktree'; // older callers: the log is always visible now
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  $('#list-title').textContent = VIEW_TITLES[view] || 'Files';
  const wt = $('#wt-row');
  if (wt) wt.classList.toggle('selected', view === 'worktree' && !state.selectedCommits.length);
  renderView();
}

function renderView() {
  if (!state.repo) return;
  if (state.view === 'worktree') renderWorktree();
  else if (state.view === 'stashes') renderStashes();
  else if (state.view === 'pulls') renderPulls();
  else if (state.view === 'repository') renderRepository();
  else renderBranches();
}

function detail(html) {
  $('#detail-pane').innerHTML = html;
}

// Unified / side-by-side switch shown in diff headers.
function modeToggle() {
  const b = (mode, label) => '<button class="seg-btn' + (state.diffMode === mode ? ' active' : '') +
    '" data-mode="' + mode + '">' + label + '</button>';
  return '<span class="seg" role="group" aria-label="Diff layout">' + b('unified', 'Unified') + b('split', 'Side by side') + '</span>';
}

// Where a header gets the diff layout switch. NUL cannot occur in paths or messages.
const MODE_SLOT = '\u0000mode\u0000';

// Show a diff in the detail pane; hunkActions adds per-hunk buttons. wire() attaches
// the header's handlers and runs after every redraw (layout switch included).
function showDiff(headerHtml, diffText, hunkActions, wire) {
  state.detailFiles = diffText && diffText.trim() ? window.GitDiff.parse(diffText) : [];
  state.redrawDetail = () => {
    detail(headerHtml.replace(MODE_SLOT, modeToggle()) +
      (state.detailFiles.length
        ? window.GitDiff.renderFiles(state.detailFiles, { mode: state.diffMode, hunkActions })
        : '<div class="diff-empty">No changes</div>'));
    if (wire) wire();
  };
  state.redrawDetail();
}

// ---------- operation banner (merge / cherry-pick / revert / rebase stopped) ----------
function opBanner() {
  if (!state.op) return '';
  const label = OP_LABELS[state.op] || state.op;
  const blocked = state.status.conflicted.length > 0;
  return '<div class="op-banner"><div><strong>' + esc(label) + ' in progress</strong>' +
    '<div class="op-hint">' + (blocked ? 'Resolve the conflicts below, then continue.' : 'All conflicts resolved.') + '</div></div>' +
    '<span class="actions"><button class="btn btn-sm btn-primary" id="act-op-continue"' + (blocked ? ' disabled' : '') + '>Continue</button>' +
    '<button class="btn btn-sm btn-danger" id="act-op-abort">Abort</button></span></div>';
}

function wireOpBanner() {
  const cont = $('#act-op-continue');
  if (cont) cont.onclick = () => act('gd:continueOp', OP_LABELS[state.op] + ' completed', { op: state.op });
  const abort = $('#act-op-abort');
  if (abort) {
    abort.onclick = () => {
      if (!window.confirm('Abort the ' + (OP_LABELS[state.op] || state.op).toLowerCase() + '? Its changes will be discarded.')) return;
      act('gd:abortOp', OP_LABELS[state.op] + ' aborted', { op: state.op });
    };
  }
}

// ---------- working tree ----------
function renderWorktree() {
  const st = state.status;
  let html = opBanner();

  if (st.conflicted.length) {
    html += sectionHeader('Conflicts (' + st.conflicted.length + ')', '');
    for (const e of st.conflicted) {
      html += fileRow(e, 'conflicted', badgeFor('U'), 'act-stage');
    }
  }

  html += sectionHeader('Staged (' + st.staged.length + ')',
    st.staged.length ? '<button class="btn btn-sm" id="act-unstage-all">Unstage all</button>' : '');
  if (st.staged.length === 0) html += emptyRow('Nothing staged');
  for (const e of st.staged) {
    html += fileRow(e, 'staged', badgeFor(e.x), 'act-unstage');
  }

  html += sectionHeader('Changes (' + (st.unstaged.length + st.untracked.length) + ')',
    (st.unstaged.length + st.untracked.length) ? '<button class="btn btn-sm" id="act-stage-all">Stage all</button>' : '');
  if (st.unstaged.length === 0 && st.untracked.length === 0) html += emptyRow('Working tree clean');
  for (const e of st.unstaged) {
    html += fileRow(e, 'unstaged', badgeFor(e.y), 'act-stage');
  }
  for (const e of st.untracked) {
    html += fileRow(e, 'untracked', badgeFor('?'), 'act-stage');
  }

  const canCommit = st.staged.length > 0 || state.amend;
  html += '<div class="commit-box">' +
    '<textarea id="commit-msg" spellcheck="true" placeholder="Commit message">' + esc(state.commitDraft) + '</textarea>' +
    '<div class="commit-row">' +
    '<label class="check"><input type="checkbox" id="commit-amend"' + (state.amend ? ' checked' : '') + '> Amend last commit</label>' +
    '<span class="commit-hint" id="commit-hint">' + st.staged.length + ' file(s) staged</span>' +
    '<button class="btn btn-primary" id="act-commit" ' + (canCommit ? '' : 'disabled') + '>' + (state.amend ? 'Amend' : 'Commit') + '</button>' +
    '</div></div>';

  $('#list-pane').innerHTML = html;
  wireCommon();
  wireOpBanner();

  // Keep the draft across re-renders triggered by stage/unstage.
  $('#commit-msg').oninput = (ev) => { state.commitDraft = ev.target.value; };
  $('#commit-amend').onchange = async (ev) => {
    state.amend = ev.target.checked;
    // Amending starts from the previous message, as most Git clients do.
    if (state.amend && !state.commitDraft.trim()) {
      try { state.commitDraft = await api('gd:lastMessage', { repo: state.repo }); } catch (e) { toast(e.message, 'error'); }
    }
    renderWorktree();
  };

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
  const actionGlyph = actionClass === 'act-stage' ? '+' : '−';
  const actionTitle = kind === 'conflicted' ? 'Mark resolved' : actionClass === 'act-stage' ? 'Stage' : 'Unstage';
  const discard = kind === 'unstaged' || kind === 'untracked'
    ? '<button class="btn btn-sm btn-danger act-discard" data-kind="' + kind + '" data-path="' + esc(e.path) + '" title="Discard changes">&#10005;</button>'
    : '';
  return '<div class="row' + sel + '" data-kind="' + kind + '" data-path="' + esc(e.path) + '">' +
    badge +
    '<span class="path"><span class="dir">' + esc(dirPart(e.path)) + '</span>' + esc(basePart(e.path)) +
    (e.oldPath ? ' <span style="color:var(--muted)">(from ' + esc(e.oldPath) + ')</span>' : '') + '</span>' +
    '<span class="row-actions">' + discard +
    '<button class="btn btn-sm ' + actionClass + '" data-path="' + esc(e.path) + '" title="' + actionTitle + '">' + actionGlyph + '</button></span>' +
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
  document.querySelectorAll('#list-pane .act-discard').forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const untracked = b.dataset.kind === 'untracked';
      const what = untracked ? 'Delete the untracked file ' : 'Discard all changes to ';
      if (!window.confirm(what + b.dataset.path + '? This cannot be undone.')) return;
      act('gd:discard', 'Discarded ' + b.dataset.path,
        untracked ? { untracked: [b.dataset.path] } : { paths: [b.dataset.path] });
    };
  });
}

function fileHeader(path, label, extra) {
  return '<div class="detail-header"><span class="title">' + esc(path) + '</span>' +
    '<span class="detail-label">' + esc(label) + '</span>' + (extra || '') + MODE_SLOT + '</div>';
}

async function showFileDetail(kind, path) {
  try {
    const btn = (id, label, title) => '<button class="btn btn-sm" id="' + id + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + label + '</button>';
    const back = () => showFileDetail(kind, path);
    const tools = btn('act-edit', 'Edit', 'Edit the working-tree file') + (kind === 'untracked' ? '' : btn('act-blame', 'Blame'));
    const wire = () => {
      $('#act-edit').onclick = () => showEditor(path, back);
      const blame = $('#act-blame');
      if (blame) blame.onclick = () => showBlame(path, back);
      const stash = $('#act-stash-file');
      if (stash) stash.onclick = () => act('gd:stashSave', 'Stashed ' + path, { message: '', includeUntracked: kind === 'untracked', paths: [path] });
    };
    const lineHint = state.diffMode === 'unified' ? ' Click lines to pick them.' : '';
    if (kind === 'staged') {
      const diffText = await api('gd:diffStaged', { repo: state.repo, path });
      showDiff(fileHeader(path, 'Staged changes', tools), diffText,
        [{ action: 'unstage-lines', label: 'Unstage lines', lines: true }, { action: 'unstage', label: 'Unstage hunk' }], wire);
    } else if (kind === 'unstaged') {
      const diffText = await api('gd:diffWorking', { repo: state.repo, path });
      showDiff(fileHeader(path, 'Working tree changes' + lineHint, tools + btn('act-stash-file', 'Stash file', 'Stash only this file')), diffText,
        [{ action: 'discard-lines', label: 'Discard lines', danger: true, lines: true }, { action: 'discard', label: 'Discard hunk', danger: true },
          { action: 'stage-lines', label: 'Stage lines', lines: true }, { action: 'stage', label: 'Stage hunk' }], wire);
    } else if (kind === 'conflicted') {
      await showConflict(path);
    } else {
      state.detailFiles = [];
      state.redrawDetail = null;
      detail('<div class="detail-header"><span class="title">' + esc(path) + '</span><span class="badge badge-untracked">untracked</span>' +
        tools + btn('act-stash-file', 'Stash file', 'Stash only this file') + '</div>' +
        '<div class="diff-empty">New file, not yet in Git. Stage it to include it in the next commit.</div>');
      wire();
    }
  } catch (e) { toast(e.message, 'error'); }
}

// Plain editor for a working-tree file (text only; binary files are refused by the main process).
async function showEditor(path, back) {
  let text;
  try { text = await api('gd:readFile', { repo: state.repo, path }); }
  catch (e) { toast(e.message, 'error'); return; }
  const crlf = text.includes('\r\n');
  state.detailFiles = [];
  state.redrawDetail = null;
  detail('<div class="detail-header"><span class="title">' + esc(path) + '</span><span class="detail-label">Editing' + (crlf ? ' (CRLF)' : '') + '</span>' +
    '<button class="btn btn-sm" id="act-edit-cancel">Cancel</button><button class="btn btn-sm btn-primary" id="act-edit-save">Save</button></div>' +
    '<textarea id="file-editor" class="file-editor" spellcheck="false" wrap="off"></textarea>');
  const area = $('#file-editor');
  area.value = crlf ? text.replace(/\r\n/g, '\n') : text;
  area.focus();
  area.onkeydown = (ev) => {
    if (ev.key === 's' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); $('#act-edit-save').click(); }
    if (ev.key === 'Tab' && !ev.shiftKey) { ev.preventDefault(); area.setRangeText('\t', area.selectionStart, area.selectionEnd, 'end'); }
  };
  $('#act-edit-cancel').onclick = back;
  $('#act-edit-save').onclick = async () => {
    try {
      await api('gd:writeFile', { repo: state.repo, path, content: crlf ? area.value.replace(/\n/g, '\r\n') : area.value });
      toast('Saved ' + path, 'success');
      await refreshAll();
      reselectFile();
    } catch (e) { toast(e.message, 'error'); }
  };
}

// Re-open the selected working-tree file after an action changed it.
function reselectFile() {
  const key = state.selectedKey || '';
  const i = key.indexOf(':');
  if (i === -1) return;
  const kind = key.slice(0, i), path = key.slice(i + 1);
  const st = state.status;
  const still = { staged: st.staged, unstaged: st.unstaged, conflicted: st.conflicted, untracked: st.untracked }[kind];
  if (still && still.some((e) => e.path === path)) showFileDetail(kind, path);
}

// ---------- hunk and line actions (delegated: the detail pane is re-rendered often) ----------
const HUNK_ACTIONS = {
  stage: { opts: { cached: true }, done: 'Staged hunk' },
  unstage: { opts: { cached: true, reverse: true }, done: 'Unstaged hunk' },
  discard: { opts: { reverse: true }, done: 'Discarded hunk', confirm: 'Discard this hunk? This cannot be undone.' },
  // Line patches for unstage / discard are built against the side being changed (reverse).
  'stage-lines': { lines: true, opts: { cached: true }, done: 'Staged selected lines' },
  'unstage-lines': { lines: true, reverse: true, opts: { cached: true, reverse: true }, done: 'Unstaged selected lines' },
  'discard-lines': { lines: true, reverse: true, opts: { reverse: true }, done: 'Discarded selected lines', confirm: 'Discard the selected lines? This cannot be undone.' },
};

async function onHunkAction(btn) {
  const spec = HUNK_ACTIONS[btn.dataset.action];
  const fi = Number(btn.dataset.file), hi = Number(btn.dataset.hunk);
  const file = state.detailFiles[fi];
  if (!spec || !file) return;
  let patch;
  try {
    if (spec.lines) {
      const picked = [...document.querySelectorAll('.diff-row.sel[data-file="' + fi + '"][data-hunk="' + hi + '"]')].map((r) => Number(r.dataset.line));
      patch = window.GitDiff.linesPatch(file, hi, picked, !!spec.reverse);
    } else patch = window.GitDiff.hunkPatch(file, hi);
  } catch (e) { toast(e.message, 'error'); return; }
  if (spec.confirm && !window.confirm(spec.confirm)) return;
  try {
    await api('gd:applyPatch', Object.assign({ repo: state.repo, patch }, spec.opts));
    toast(spec.done, 'success');
    await refreshAll();
    reselectFile();
  } catch (e) { toast(e.message, 'error'); }
}

function wireDetailPane() {
  $('#detail-pane').addEventListener('click', (ev) => {
    const hunk = ev.target.closest('.hunk-act');
    if (hunk) { onHunkAction(hunk); return; }
    const row = ev.target.closest('.diff-row.selectable');
    if (row) { row.classList.toggle('sel'); return; }
    const seg = ev.target.closest('.seg-btn[data-mode]');
    if (seg && state.redrawDetail) {
      state.diffMode = seg.dataset.mode;
      savePref('diffMode', state.diffMode);
      state.redrawDetail();
    }
  });
}

// ---------- blame ----------
const ZERO_HASH = /^0+$/;

// rev: blame the file as of that commit (null: the working tree).
async function showBlame(path, back, rev) {
  try {
    const lines = await api('gd:blame', { repo: state.repo, path, rev: rev || null });
    state.detailFiles = [];
    state.redrawDetail = null;
    let rows = '';
    let prev = null;
    for (const l of lines) {
      const first = l.hash !== prev;
      prev = l.hash;
      const uncommitted = ZERO_HASH.test(l.hash);
      const meta = !first ? '' : uncommitted
        ? '<span class="blame-hash">&#8212;</span><span class="blame-author">Not committed yet</span><span></span>'
        : '<button class="blame-hash" data-hash="' + esc(l.hash) + '" title="' + esc(l.summary) + '">' + esc(l.hash.slice(0, 8)) + '</button>' +
          '<span class="blame-author">' + esc(l.author) + '</span><span class="blame-date">' + esc(fmtDate(l.time)) + '</span>' +
          '<button class="blame-older" data-hash="' + esc(l.hash) + '" title="Blame the file before this commit">&#8630;</button>';
      rows += '<div class="blame-row' + (first ? ' first' : '') + '"><span class="blame-meta">' + meta + '</span>' +
        '<span class="diff-no">' + l.line + '</span><span class="diff-text">' + esc(l.text || ' ') + '</span></div>';
    }
    detail('<div class="detail-header"><span class="title">' + esc(path) + '</span><span class="detail-label">Blame' +
      (rev ? ' at ' + esc(rev.replace(/\^$/, '').slice(0, 8) + (rev.endsWith('^') ? '^' : '')) : '') + '</span>' +
      (rev ? '<button class="btn btn-sm" id="act-blame-now">Blame current</button>' : '') +
      '<button class="btn btn-sm" id="act-blame-back">Back to diff</button></div>' +
      '<div class="blame-table">' + (rows || '<div class="diff-empty">Empty file</div>') + '</div>');
    $('#act-blame-back').onclick = back;
    const now = $('#act-blame-now');
    if (now) now.onclick = () => showBlame(path, back);
    document.querySelectorAll('.blame-hash[data-hash]').forEach((b) => {
      b.onclick = () => selectCommitInLog(b.dataset.hash);
    });
    document.querySelectorAll('.blame-older').forEach((b) => {
      b.onclick = () => showBlame(path, back, b.dataset.hash + '^');
    });
  } catch (e) { toast(e.message, 'error'); }
}

async function act(channel, okMsg, extra) {
  try {
    await api(channel, Object.assign({ repo: state.repo }, extra || {}));
    toast(okMsg, 'success');
    await refreshAll();
  } catch (e) {
    toast(e.message, 'error');
    // A failed merge / cherry-pick can still leave conflicts behind: show them.
    await refreshAll().catch(() => {});
  }
}

// Start an empty commit message from commit.template, when the repository has one.
async function prefillTemplate() {
  if (state.commitDraft.trim()) return;
  try {
    const tpl = await api('gd:commitTemplate', { repo: state.repo });
    if (tpl && !state.commitDraft.trim()) {
      state.commitDraft = tpl;
      if (state.view === 'worktree') renderWorktree();
    }
  } catch { /* a missing or unreadable template just leaves the box empty */ }
}

async function doCommit() {
  const msg = $('#commit-msg').value;
  if (!msg.trim()) { toast('Write a commit message first', 'error'); return; }
  try {
    const res = await api('gd:commit', { repo: state.repo, message: msg, amend: state.amend });
    state.commitDraft = '';
    state.amend = false;
    toast((res.head ? 'Committed ' + res.head.short : 'Committed'), 'success');
    await refreshAll();
    await prefillTemplate();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- toolbar ----------
async function openDialog() {
  try {
    const dir = await api('gd:openDialog', {});
    if (dir) await openRepo(dir);
  } catch (e) {
    toast(e.message + ' (is it a Git repository?)', 'error');
  }
}

// Network operations can wait on the credential dialog: lock the buttons meanwhile.
const NET_BUTTONS = ['#btn-fetch', '#btn-pull', '#btn-push'];
async function networkOp(channel, busyMsg, okMsg, extra) {
  if (!state.repo) return;
  NET_BUTTONS.forEach((s) => { $(s).disabled = true; });
  toast(busyMsg, '', true);
  try { await act(channel, okMsg, extra || {}); }
  finally { NET_BUTTONS.forEach((s) => { $(s).disabled = false; }); }
}

function pull() {
  const rebase = loadPref('pullMode', 'merge') === 'rebase';
  return networkOp('gd:pull', rebase ? 'Pulling (rebase)…' : 'Pulling…', 'Pulled', { rebase }).then(() => {
    if (state.op) setView('worktree'); // stopped on conflicts
  });
}

// Toolbar: Commit jumps to the message box in the working tree.
function focusCommit() {
  if (!state.repo) return;
  state.selectedCommits = [];
  setView('worktree');
  const box = $('#commit-msg');
  if (box) box.focus();
}

async function newBranchDialog() {
  if (!state.repo) return;
  const v = await formDialog({ title: 'New branch at ' + (state.branch || 'HEAD'), ok: 'Create', fields: [
    { name: 'name', label: 'Branch name', placeholder: 'feature/name' },
    { name: 'checkout', label: 'Switch to it', type: 'checkbox', value: true }] });
  if (!v || !v.name.trim()) return;
  try {
    await api('gd:createBranch', { repo: state.repo, name: v.name.trim() });
    if (v.checkout) await api('gd:switchBranch', { repo: state.repo, name: v.name.trim() });
    toast('Created ' + v.name.trim(), 'success');
    await refreshAll();
  } catch (e) { toast(e.message, 'error'); }
}

async function mergeDialog() {
  if (!state.repo) return;
  const b = state.branchesData || { local: [], remote: [] };
  const names = b.local.filter((x) => !x.isCurrent).map((x) => x.name).concat(b.remote.map((x) => x.name));
  if (!names.length) { toast('No other branch to merge', ''); return; }
  const v = await formDialog({ title: 'Merge into ' + state.branch, ok: 'Merge',
    note: 'If the merge stops on conflicts, they are listed in the working tree.', fields: [
      { name: 'name', label: 'Branch', type: 'select', value: names[0], options: names.map((n) => ({ value: n, label: n })) }] });
  if (!v) return;
  await act('gd:merge', 'Merged ' + v.name, { name: v.name });
  if (state.op === 'merge') setView('worktree');
}

function wireToolbar() {
  $('#btn-open').onclick = openDialog;
  $('#btn-commit').onclick = focusCommit;
  $('#btn-branch').onclick = newBranchDialog;
  $('#btn-merge').onclick = mergeDialog;
  $('#btn-stash').onclick = () => { if (state.repo) setView('stashes'); };
  $('#btn-layout').onclick = cycleLayout;
  $('#btn-open-2').onclick = openDialog;
  $('#btn-refresh').onclick = () => state.repo ? refreshAll().catch((e) => toast(e.message, 'error')) : null;
  $('#btn-fetch').onclick = () => networkOp('gd:fetch', 'Fetching…', 'Fetched');
  $('#btn-pull').onclick = pull;
  $('#btn-push').onclick = () => networkOp('gd:push', 'Pushing…', 'Pushed');
  $('#branch-pill').onclick = () => setView('branches');
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.onclick = () => setView(el.dataset.view);
  });
}

document.querySelectorAll('.needs-repo').forEach((b) => { b.disabled = true; });
initDock();
wireToolbar();
wireDetailPane();
wireRefTree();
initSettings();

// Restore tabs; ?repo=<path> (GitDeck --path=...) opens that repository too.
(function autoOpen() {
  let repo = null;
  try {
    const params = new URLSearchParams(window.location.search);
    repo = params.get('repo');
    const view = params.get('view');
    if (['history', 'branches', 'worktree', 'stashes', 'pulls', 'repository'].includes(view)) {
      state.view = view === 'history' ? 'worktree' : view;
      $('#list-title').textContent = VIEW_TITLES[state.view];
      document.querySelectorAll('.nav-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.view === state.view);
      });
    }
  } catch (_e) { /* ignore */ }
  document.title = 'GitDeck';
  initTabs(repo).catch((e) => toast(e.message, 'error'));
})();
