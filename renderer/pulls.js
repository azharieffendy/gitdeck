'use strict';
// GitDeck GitHub pull requests: list, read (Markdown body + comments), check out,
// open in the browser, create. The token never reaches the renderer: every call
// goes through the main process. Classic script: shares globals with app.js.

const pullsState = { filter: 'open', info: null, list: null, error: null, repo: null };

async function loadPulls() {
  pullsState.repo = state.repo;
  pullsState.error = null;
  pullsState.list = null;
  try {
    if (!pullsState.info) pullsState.info = await api('gd:ghInfo', { repo: state.repo });
    pullsState.list = await api('gd:ghPulls', { repo: state.repo, state: pullsState.filter });
  } catch (e) { pullsState.error = e.message; }
  if (state.view === 'pulls') drawPulls();
}

function renderPulls() {
  if (pullsState.repo !== state.repo) { pullsState.info = null; pullsState.list = null; }
  drawPulls();
  if (!pullsState.list && !pullsState.error) loadPulls();
}

function drawPulls() {
  const info = pullsState.info;
  const opt = (v, l) => '<option value="' + v + '"' + (pullsState.filter === v ? ' selected' : '') + '>' + l + '</option>';
  let html = '<div class="section-header history-head"><span>' + (info ? esc(info.owner + '/' + info.repo) : 'Pull requests') + '</span><span class="actions">' +
    '<select id="pr-filter" class="filter-input">' + opt('open', 'Open') + opt('closed', 'Closed') + opt('all', 'All') + '</select>' +
    '<button class="btn btn-sm" id="act-pr-reload" title="Reload">&#8635;</button>' +
    '<button class="btn btn-sm btn-primary" id="act-pr-new"' + (info ? '' : ' disabled') + '>New</button></span></div>';
  if (pullsState.error) {
    html += '<div class="empty-state"><div class="empty-title">GitHub unavailable</div><div class="empty-hint">' + esc(pullsState.error) +
      '</div><div class="empty-hint">Needs a github.com remote and a token: GITHUB_TOKEN / GH_TOKEN, or a github.com login saved in Git\'s credential helper.</div></div>';
  } else if (!pullsState.list) html += '<div class="diff-empty">Loading…</div>';
  else if (!pullsState.list.length) html += emptyRow('No ' + (pullsState.filter === 'all' ? '' : pullsState.filter + ' ') + 'pull requests');
  else {
    for (const p of pullsState.list) {
      const sel = state.selectedKey === 'pr:' + p.number ? ' selected' : '';
      html += '<div class="row pr-row' + sel + '" data-number="' + p.number + '">' +
        '<span class="pr-state pr-' + esc(p.draft ? 'draft' : p.state) + '">' + esc(p.draft ? 'draft' : p.state) + '</span>' +
        '<span class="path">#' + p.number + ' ' + esc(p.title) + '<div class="remote-url">' + esc(p.head + ' → ' + p.base + ' · ' + (p.author || '')) + '</div></span>' +
        '<span class="date">' + esc(fmtDate(Date.parse(p.updated))) + '</span></div>';
    }
  }
  $('#list-pane').innerHTML = html;
  $('#pr-filter').onchange = (ev) => { pullsState.filter = ev.target.value; loadPulls(); drawPulls(); };
  $('#act-pr-reload').onclick = () => { pullsState.info = null; loadPulls(); drawPulls(); };
  $('#act-pr-new').onclick = newPullDialog;
  document.querySelectorAll('.pr-row').forEach((row) => {
    row.onclick = () => {
      state.selectedKey = 'pr:' + row.dataset.number;
      document.querySelectorAll('.pr-row').forEach((r) => r.classList.toggle('selected', r === row));
      showPull(Number(row.dataset.number));
    };
  });
}

async function showPull(number) {
  state.detailFiles = [];
  state.redrawDetail = null;
  detail('<div class="diff-empty">Loading #' + number + '…</div>');
  try {
    const p = await api('gd:ghPull', { repo: state.repo, number });
    const md = (text) => '<div class="md">' + (text.trim() ? window.GitMarkdown.render(text) : '<p class="muted">No description.</p>') + '</div>';
    detail('<div class="detail-header"><span class="title">#' + p.number + ' ' + esc(p.title) + '</span>' +
      '<button class="btn btn-sm" id="act-pr-open">Open in browser</button>' +
      (p.state === 'open' ? '<button class="btn btn-sm btn-primary" id="act-pr-checkout" title="Fetch into branch pr-' + p.number + ' and switch to it">Check out</button>' : '') + '</div>' +
      '<div class="detail-meta"><div class="byline"><span class="pr-state pr-' + esc(p.draft ? 'draft' : p.state) + '">' + esc(p.draft ? 'draft' : p.state) + '</span> ' +
      esc((p.author || '') + ' wants to merge ' + p.commits + ' commit(s) from ' + p.head + ' into ' + p.base) +
      ' &#183; <span class="add-count">+' + p.additions + '</span> <span class="del-count">−' + p.deletions + '</span> in ' + p.changedFiles + ' file(s)</div></div>' +
      '<div class="pr-body">' + md(p.body) +
      p.comments.map((c) => '<div class="pr-comment"><div class="pr-comment-head">' + esc(c.author || '') + ' &#183; ' + esc(fmtDate(Date.parse(c.created))) + '</div>' + md(c.body) + '</div>').join('') +
      '</div>');
    $('#act-pr-open').onclick = () => api('gd:openExternal', { url: p.url }).catch((e) => toast(e.message, 'error'));
    const co = $('#act-pr-checkout');
    if (co) {
      co.onclick = async () => {
        if (!(await confirmDialog('Fetch #' + p.number + ' into branch pr-' + p.number + ' and switch to it?', { ok: 'Check out' }))) return;
        try {
          const branch = await api('gd:ghCheckout', { repo: state.repo, number: p.number });
          toast('Switched to ' + branch, 'success');
          await refreshAll();
        } catch (e) { toast(e.message, 'error'); }
      };
    }
  } catch (e) { detail('<div class="diff-empty">' + esc(e.message) + '</div>'); }
}

async function newPullDialog() {
  const info = pullsState.info;
  const locals = ((state.branchesData && state.branchesData.local) || []).map((b) => b.name);
  const head = state.log.find((c) => c.isHead);
  const v = await formDialog({ title: 'New pull request on ' + info.owner + '/' + info.repo, ok: 'Create pull request',
    note: 'The head branch must already be pushed to ' + info.remote + '.', fields: [
      { name: 'title', label: 'Title', value: head && state.branch !== info.defaultBranch ? head.subject : '' },
      { name: 'head', label: 'From (head branch)', type: 'select', value: state.branch, options: locals.map((n) => ({ value: n, label: n })) },
      { name: 'base', label: 'Into (base branch)', value: info.defaultBranch },
      { name: 'body', label: 'Description (Markdown)', type: 'textarea', rows: 8 },
      { name: 'draft', label: 'Create as draft', type: 'checkbox', value: false }] });
  if (!v) return;
  if (!v.title.trim()) { toast('A pull request needs a title', 'error'); return; }
  try {
    const p = await api('gd:ghCreatePull', { repo: state.repo, title: v.title, body: v.body, head: v.head, base: v.base.trim(), draft: v.draft });
    toast('Created #' + p.number, 'success');
    pullsState.filter = 'open';
    state.selectedKey = 'pr:' + p.number;
    await loadPulls();
    showPull(p.number);
  } catch (e) { toast(e.message, 'error'); }
}

// Markdown links: only http(s) URLs are rendered as links; open them outside the app.
document.addEventListener('click', (ev) => {
  const a = ev.target.closest && ev.target.closest('a.md-link');
  if (!a) return;
  ev.preventDefault();
  api('gd:openExternal', { url: a.getAttribute('href') }).catch((e) => toast(e.message, 'error'));
});
