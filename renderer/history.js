'use strict';
// GitDeck history view: commit graph, filter, reflog, multi-select cherry-pick, and
// the commit detail (cherry-pick, revert, tag, branch, interactive rebase from here).
// Classic script: shares globals with app.js.

function commitMatches(c, q) {
  if (!q) return true;
  if (c.hash.startsWith(q)) return true;
  const hay = (c.subject + '\n' + c.authorName + '\n' + c.refs.map((r) => r.name).join('\n')).toLowerCase();
  return hay.includes(q);
}

// The log is its own docked panel, always visible next to the working tree.
function renderHistory() {
  const pane = $('#log-pane');
  if (!state.repo) return;
  if (!state.log.length && !state.showReflog) {
    pane.innerHTML = '<div class="empty-state"><div class="empty-title">No commits yet</div>' +
      '<div class="empty-hint">Make your first commit from the working tree.</div></div>';
    $('#log-sub').textContent = '';
    return;
  }
  const filterFocused = document.activeElement && document.activeElement.id === 'history-filter';
  pane.innerHTML = '<div class="section-header history-head"><span id="history-title"></span><span class="actions">' +
    (state.showReflog ? '' : '<input id="history-filter" class="filter-input" type="search" placeholder="Filter: message, author, hash, ref" value="' +
      esc(state.historyFilter) + '" spellcheck="false">') +
    '<button class="btn btn-sm' + (state.showReflog ? ' active' : '') + '" id="act-reflog" title="Where HEAD has been">Reflog</button></span></div>' +
    '<div id="history-body" class="history-body"></div>';
  const filter = $('#history-filter');
  if (filter) {
    filter.oninput = () => { state.historyFilter = filter.value; renderHistoryBody(); };
    if (filterFocused) { filter.focus(); filter.setSelectionRange(filter.value.length, filter.value.length); }
  }
  $('#act-reflog').onclick = () => { state.showReflog = !state.showReflog; renderHistory(); };
  if (state.showReflog) renderReflog(); else renderHistoryBody();
}

function commitRow(c, refsHtml) {
  const sel = state.selectedCommits.includes(c.hash) ? ' selected' : '';
  return '<div class="hrow' + sel + '" data-hash="' + esc(c.hash) + '">' +
    '<span class="subject">' + refsHtml + '<span class="subj-text">' + esc(c.subject) + '</span></span>' +
    '<span class="author">' + esc(c.authorName) + '</span>' +
    '<span class="date">' + esc(fmtDate(c.timestamp)) + '</span>' +
    '<span class="sha">' + esc(c.short || c.hash.slice(0, 7)) + '</span></div>';
}

// Pseudo-row above the graph: uncommitted changes (or a stopped merge / rebase).
function worktreeRow() {
  const st = state.status;
  if (!st) return '';
  const n = st.staged.length + st.unstaged.length + st.untracked.length + st.conflicted.length;
  if (!n && !state.op) return '';
  const sel = state.view === 'worktree' && !state.selectedCommits.length ? ' selected' : '';
  const label = state.op ? (OP_LABELS[state.op] || state.op) + ' in progress, ' + n + ' changed files' : 'Local changes (' + n + ')';
  return '<div class="hrow wt-row' + sel + '" id="wt-row" title="Show the working tree"><span class="subject"><span class="wt-node"></span><span class="subj-text">' +
    esc(label) + '</span></span><span></span><span></span><span></span></div>';
}

function renderHistoryBody() {
  const q = state.historyFilter.trim().toLowerCase();
  const shown = q ? state.log.filter((c) => commitMatches(c, q)) : state.log;
  $('#history-title').textContent = q ? shown.length + ' of ' + state.log.length + ' commits' : '';
  $('#log-sub').textContent = state.log.length + ' commits';
  let rows = '';
  for (const c of shown) {
    let refs = c.isHead ? '<span class="ref-badge head">HEAD</span>' : '';
    for (const r of c.refs) refs += '<span class="ref-badge ' + esc(r.kind) + '">' + esc(r.name) + '</span>';
    rows += commitRow(c, refs);
  }
  // The graph only makes sense for the unfiltered, contiguous history.
  const graph = q ? '' : '<div class="graph-col">' + window.GitGraph.svg(window.GitGraph.layout(state.log)) + '</div>';
  $('#history-body').innerHTML = (q ? '' : worktreeRow()) + (shown.length
    ? '<div class="history-wrap' + (q ? ' no-graph' : '') + '">' + graph + '<div class="history-rows">' + rows + '</div></div>'
    : '<div class="diff-empty">No commit matches</div>');
  const wt = $('#wt-row');
  if (wt) {
    wt.onclick = () => {
      state.selectedCommits = [];
      state.anchorCommit = null;
      document.querySelectorAll('#history-body .hrow').forEach((r) => r.classList.toggle('selected', r === wt));
      setView('worktree');
      detail('');
    };
  }
  const order = shown.map((c) => c.hash);
  document.querySelectorAll('#history-body .hrow').forEach((row) => {
    row.onclick = (ev) => onCommitClick(ev, row.dataset.hash, order);
  });
}

async function renderReflog() {
  $('#history-title').textContent = 'Reflog';
  const body = $('#history-body');
  body.innerHTML = '<div class="diff-empty">Loading…</div>';
  try {
    const entries = await api('gd:reflog', { repo: state.repo });
    if (!state.showReflog) return;
    body.innerHTML = entries.length ? entries.map((r) => '<div class="hrow reflog-row" data-hash="' + esc(r.hash) + '">' +
      '<span class="subject"><span class="ref-badge local">' + esc(r.selector) + '</span><span class="subj-text">' + esc(r.subject) + '</span></span><span></span>' +
      '<span class="date">' + esc(fmtDate(r.timestamp)) + '</span>' +
      '<span class="sha">' + esc(r.short) + '</span></div>').join('') : '<div class="diff-empty">Empty reflog</div>';
    body.querySelectorAll('.reflog-row').forEach((row) => {
      row.onclick = () => {
        body.querySelectorAll('.hrow').forEach((r) => r.classList.toggle('selected', r === row));
        state.selectedCommits = [row.dataset.hash];
        showCommitDetail(row.dataset.hash);
      };
    });
  } catch (e) { body.innerHTML = '<div class="diff-empty">' + esc(e.message) + '</div>'; }
}

// Click selects one commit; Ctrl/Cmd-click toggles; Shift-click selects a range.
function onCommitClick(ev, hash, order) {
  const sel = state.selectedCommits;
  if (ev.shiftKey && state.anchorCommit && order.includes(state.anchorCommit)) {
    const a = order.indexOf(state.anchorCommit), b = order.indexOf(hash);
    state.selectedCommits = order.slice(Math.min(a, b), Math.max(a, b) + 1);
  } else if (ev.ctrlKey || ev.metaKey) {
    state.selectedCommits = sel.includes(hash) ? sel.filter((h) => h !== hash) : sel.concat(hash);
    state.anchorCommit = hash;
  } else {
    state.selectedCommits = [hash];
    state.anchorCommit = hash;
  }
  document.querySelectorAll('#history-body .hrow').forEach((r) => {
    r.classList.toggle('selected', state.selectedCommits.includes(r.dataset.hash));
  });
  if (state.selectedCommits.length) document.querySelectorAll('#ref-tree .tree-item.selected').forEach((r) => r.classList.remove('selected'));
  state.selectedKey = state.selectedCommits.length === 1 ? 'commit:' + state.selectedCommits[0] : null;
  if (state.selectedCommits.length === 1) showCommitDetail(state.selectedCommits[0]);
  else if (state.selectedCommits.length > 1) showMultiCommit();
  else detail('');
}

// Select one commit from outside the log (sidebar tree, blame) and keep it in view.
function selectCommitInLog(hash) {
  if (state.showReflog) { state.showReflog = false; renderHistory(); }
  if (state.historyFilter && !state.log.some((c) => c.hash === hash && commitMatches(c, state.historyFilter.trim().toLowerCase()))) {
    state.historyFilter = '';
    renderHistory();
  }
  state.selectedCommits = [hash];
  state.anchorCommit = hash;
  state.selectedKey = 'commit:' + hash;
  const body = $('#history-body');
  let target = null;
  document.querySelectorAll('#history-body .hrow').forEach((r) => {
    const on = r.dataset.hash === hash;
    r.classList.toggle('selected', on);
    if (on) target = r;
  });
  if (target && body) {
    const top = target.offsetTop, h = body.clientHeight; // .history-body is position: relative
    if (top < body.scrollTop || top > body.scrollTop + h - target.offsetHeight) body.scrollTop = Math.max(0, top - h / 3);
  }
  showCommitDetail(hash);
}

// Several commits: cherry-pick them all, oldest first.
function showMultiCommit() {
  const index = new Map(state.log.map((c, i) => [c.hash, i]));
  const picked = state.selectedCommits.filter((h) => index.has(h)).sort((a, b) => index.get(b) - index.get(a));
  const merges = picked.filter((h) => state.log[index.get(h)].parents.length > 1).length;
  state.detailFiles = [];
  state.redrawDetail = null;
  detail('<div class="detail-header"><span class="title">' + picked.length + ' commits selected</span>' +
    '<button class="btn btn-sm btn-primary" id="act-cherry-many"' + (merges || !picked.length ? ' disabled' : '') + '>Cherry-pick ' +
    picked.length + ' onto ' + esc(state.branch) + '</button></div>' +
    '<div class="detail-meta"><div class="byline">Applied in this order (oldest first). Ctrl-click to add or remove, Shift-click for a range.' +
    (merges ? ' Merge commits must be cherry-picked one at a time.' : '') + '</div></div>' +
    '<ol class="pick-list">' + picked.map((h) => {
      const c = state.log[index.get(h)];
      return '<li><span class="blame-hash">' + esc(c.short) + '</span> ' + esc(c.subject) + '</li>';
    }).join('') + '</ol>');
  $('#act-cherry-many').onclick = async () => {
    if (!window.confirm('Cherry-pick ' + picked.length + ' commits onto ' + state.branch + '?')) return;
    await act('gd:cherryPick', 'Cherry-picked ' + picked.length + ' commits', { hashes: picked });
    if (state.op) setView('worktree');
  };
}

async function showCommitDetail(hash) {
  try {
    const info = await api('gd:commitInfo', { repo: state.repo, hash });
    const m = info.meta;
    const short = m.hash.slice(0, 12);
    const btn = (id, label, title) => '<button class="btn btn-sm" id="' + id + '" title="' + esc(title) + '">' + label + '</button>';
    showDiff('<div class="detail-header"><span class="title">' + esc(short) + '</span>' +
      btn('act-cherry', 'Cherry-pick', 'Apply this commit on top of the current branch') +
      btn('act-revert', 'Revert', 'Create a commit that undoes this one') +
      btn('act-tag', 'Tag…', 'Create a tag on this commit') +
      btn('act-branch-here', 'Branch…', 'Create a branch starting at this commit') +
      btn('act-rebase-here', 'Rebase from here…', 'Interactively rebase the commits after this one') + MODE_SLOT + '</div>' +
      '<div class="detail-meta"><div class="msg">' + esc(m.message) + '</div>' +
      '<div class="byline">' + esc(m.authorName) + ' &lt;' + esc(m.authorEmail) + '&gt; &#183; ' + esc(fmtDate(Date.parse(m.date))) +
      ' &#183; parents: ' + (m.parents.length ? esc(m.parents.join(' ').slice(0, 24)) : 'root') + '</div></div>', info.diff, null, () => {
      $('#act-cherry').onclick = async () => {
        if (!window.confirm('Cherry-pick ' + short + ' onto ' + state.branch + '?')) return;
        await act('gd:cherryPick', 'Cherry-picked ' + short, { hash: m.hash });
        if (state.op) setView('worktree');
      };
      $('#act-revert').onclick = async () => {
        if (!window.confirm('Create a commit that reverts ' + short + '?')) return;
        await act('gd:revert', 'Reverted ' + short, { hash: m.hash });
        if (state.op) setView('worktree');
      };
      $('#act-tag').onclick = () => createTagDialog(m.hash);
      $('#act-branch-here').onclick = async () => {
        const v = await formDialog({ title: 'New branch at ' + short, ok: 'Create', fields: [
          { name: 'name', label: 'Branch name', placeholder: 'feature/name' },
          { name: 'checkout', label: 'Switch to it', type: 'checkbox', value: true }] });
        if (!v || !v.name.trim()) return;
        try {
          await api('gd:createBranch', { repo: state.repo, name: v.name.trim(), from: m.hash });
          if (v.checkout) await api('gd:switchBranch', { repo: state.repo, name: v.name.trim() });
          toast('Created ' + v.name.trim(), 'success');
          await refreshAll();
        } catch (e) { toast(e.message, 'error'); }
      };
      $('#act-rebase-here').onclick = () => showRebase(m.hash);
    });
  } catch (e) { toast(e.message, 'error'); }
}

// hash null tags the current HEAD.
async function createTagDialog(hash) {
  const v = await formDialog({ title: 'New tag on ' + (hash ? hash.slice(0, 12) : 'HEAD'), ok: 'Create tag', fields: [
    { name: 'name', label: 'Tag name', placeholder: 'v1.2.0' },
    { name: 'message', label: 'Message (makes an annotated tag; leave empty for a lightweight one)', type: 'textarea', rows: 3 }] });
  if (!v || !v.name.trim()) return;
  await act('gd:createTag', 'Tagged ' + v.name.trim(), { name: v.name.trim(), target: hash, message: v.message });
}
