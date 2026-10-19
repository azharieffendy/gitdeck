'use strict';
// GitDeck repository tabs: several repositories open at once, remembered across
// launches. Each tab keeps its own commit draft. Classic script: shares globals
// with app.js.

const tabState = { tabs: [], drafts: new Map() };

function saveTabs() {
  savePref('tabs', JSON.stringify(tabState.tabs));
  if (state.repo) savePref('activeTab', state.repo);
}

function renderTabs() {
  const bar = $('#tabbar');
  bar.hidden = tabState.tabs.length === 0;
  bar.innerHTML = tabState.tabs.map((p) => {
    const name = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
    return '<div class="tab' + (p === state.repo ? ' active' : '') + '" data-path="' + esc(p) + '" title="' + esc(p) + '" role="tab">' +
      '<span class="tab-name">' + esc(name) + '</span><button class="tab-close" data-path="' + esc(p) + '" title="Close tab">&#215;</button></div>';
  }).join('');
  bar.querySelectorAll('.tab').forEach((t) => { t.onclick = () => switchTab(t.dataset.path); });
  bar.querySelectorAll('.tab-close').forEach((b) => {
    b.onclick = (ev) => { ev.stopPropagation(); closeTab(b.dataset.path); };
  });
}

function stashDraft() {
  if (state.repo) tabState.drafts.set(state.repo, { commitDraft: state.commitDraft, amend: state.amend });
}

async function activate(repo) {
  stashDraft();
  const d = tabState.drafts.get(repo) || { commitDraft: '', amend: false };
  state.repo = repo;
  state.commitDraft = d.commitDraft;
  state.amend = d.amend;
  state.selectedKey = null;
  state.selectedCommits = [];
  state.anchorCommit = null;
  state.historyFilter = '';
  state.showReflog = false;
  state.redrawDetail = null;
  detail('');
  renderTabs();
  saveTabs();
  await refreshAll();
  if (!tabState.drafts.has(repo)) await prefillTemplate();
  tabState.drafts.set(repo, { commitDraft: state.commitDraft, amend: state.amend });
}

// Open (or focus) a repository given any folder inside it.
async function openRepo(dir) {
  try {
    const top = await api('gd:openPath', { path: dir });
    if (!tabState.tabs.includes(top)) tabState.tabs.push(top);
    await activate(top);
    toast('Opened ' + top, 'success');
  } catch (e) { toast(e.message + ' (is it a Git repository?)', 'error'); }
}

async function switchTab(repo) {
  if (repo === state.repo) return;
  try { await activate(repo); } catch (e) { toast(e.message, 'error'); }
}

function closeTab(repo) {
  const i = tabState.tabs.indexOf(repo);
  if (i === -1) return;
  tabState.tabs.splice(i, 1);
  tabState.drafts.delete(repo);
  if (repo !== state.repo) { renderTabs(); saveTabs(); return; }
  const next = tabState.tabs[Math.min(i, tabState.tabs.length - 1)];
  if (next) { state.repo = null; switchTab(next); return; }
  state.repo = null;
  saveTabs();
  renderTabs();
  showNoRepo();
}

function showNoRepo() {
  $('#repo-name').textContent = '';
  $('#branch-pill').textContent = '—';
  $('#ahead-behind').textContent = '';
  $('#head-info').textContent = '';
  $('#wt-count').textContent = '';
  $('#stash-count').textContent = '';
  $('#list-pane').innerHTML = '<div class="empty-state"><div class="empty-title">No repository open</div>' +
    '<div class="empty-hint">Open a Git repository to see its working tree, history and branches.</div>' +
    '<button id="btn-open-2" class="btn btn-primary">Open Repository</button></div>';
  $('#btn-open-2').onclick = openDialog;
  detail('<div class="empty-state"><div class="empty-title">Nothing selected</div>' +
    '<div class="empty-hint">Pick a file or a commit to inspect it here.</div></div>');
}

// Restore the remembered tabs; a ?repo= launch argument is opened (and focused) too.
async function initTabs(launchRepo) {
  let saved = [];
  try { saved = JSON.parse(loadPref('tabs', '[]')); } catch { saved = []; }
  tabState.tabs = Array.isArray(saved) ? saved.filter((p) => typeof p === 'string') : [];
  if (launchRepo) { await openRepo(launchRepo); return; }
  const active = loadPref('activeTab', '');
  const first = tabState.tabs.includes(active) ? active : tabState.tabs[0];
  renderTabs();
  if (!first) return;
  try { await activate(first); }
  catch (e) {
    toast(first + ': ' + e.message + ' (tab closed)', 'error');
    closeTab(first);
  }
}
