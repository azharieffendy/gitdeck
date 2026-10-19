'use strict';
// GitDeck sidebar tree: local branches, remote branches, tags and stashes.
// Click selects the ref's commit in the log; double-click a local branch to switch
// to it, a stash to open it. Classic script: shares globals with app.js.

const treeClosed = new Set((() => { try { return JSON.parse(loadPref('treeClosed', '[]')); } catch { return []; } })());

function tipOf(kind, name) {
  const c = state.log.find((x) => x.refs.some((r) => r.kind === kind && r.name === name));
  return c ? c.hash : '';
}

function treeItem(o) {
  const sel = state.selectedKey === o.key ? ' selected' : '';
  return '<div class="tree-item' + sel + (o.head ? ' is-head' : '') + '" tabindex="0" data-key="' + esc(o.key) + '" data-act="' + o.act +
    '" data-name="' + esc(o.name) + '" data-hash="' + esc(o.hash || '') + '" title="' + esc(o.title || o.name) + '">' +
    '<svg class="ti-icon"><use href="#i-' + o.icon + '"/></svg><span class="ti-label">' + esc(o.label || o.name) + '</span>' +
    (o.head ? '<span class="ti-head">HEAD</span>' : '') +
    (o.aux ? '<span class="ti-aux">' + esc(o.aux) + '</span>' : '') + '</div>';
}

function treeGroup(key, label, items) {
  const open = !treeClosed.has(key);
  return '<div class="tree-group' + (open ? ' open' : '') + '" data-group="' + key + '">' +
    '<button class="tree-head" data-group="' + key + '" aria-expanded="' + open + '"><svg class="tree-caret" viewBox="0 0 10 10"><path d="M3 1.5l4 3.5-4 3.5z"/></svg>' +
    esc(label) + '<span class="tree-count">' + items.length + '</span></button>' +
    (open ? '<div class="tree-items">' + (items.join('') || '<div class="tree-empty">None</div>') + '</div>' : '') + '</div>';
}

function renderRefTree() {
  const el = $('#ref-tree');
  if (!el) return;
  if (!state.repo) { el.innerHTML = ''; return; }
  const b = state.branchesData || { local: [], remote: [] };
  const ab = state.ab;
  const local = b.local.map((br) => treeItem({
    key: 'ref:local:' + br.name, act: 'local', name: br.name, icon: 'branch', head: br.isCurrent,
    hash: tipOf('local', br.name), aux: br.isCurrent && ab ? '↑' + ab.ahead + ' ↓' + ab.behind : '',
    title: br.name + (br.upstream ? ' → ' + br.upstream : '') + (br.isCurrent ? '' : ' (double-click to switch)'),
  }));
  const remote = b.remote.map((br) => treeItem({ key: 'ref:remote:' + br.name, act: 'remote', name: br.name, icon: 'remote', hash: tipOf('remote', br.name) }));
  const tags = state.tags.map((t) => treeItem({ key: 'ref:tag:' + t.name, act: 'tag', name: t.name, icon: 'tag', hash: t.commit, title: t.name + (t.subject ? ': ' + t.subject : '') }));
  const stashes = state.stashes.map((s) => treeItem({ key: 'stash:' + s.ref, act: 'stash', name: s.ref, icon: 'stash', title: s.subject + ' (double-click to open)', aux: '' }));
  el.innerHTML = treeGroup('local', 'Local branches', local) + treeGroup('remote', 'Remote branches', remote) +
    treeGroup('tags', 'Tags', tags) + treeGroup('stashes', 'Stashes', stashes);
}

function onTreeClick(item, dbl) {
  const d = item.dataset;
  if (d.act === 'stash') {
    if (!dbl) { markTreeSelection(d.key); return; }
    state.selectedKey = d.key;
    setView('stashes');
    showStash(d.name);
    return;
  }
  markTreeSelection(d.key);
  if (dbl && d.act === 'local' && !item.classList.contains('is-head')) {
    act('gd:switchBranch', 'Switched to ' + d.name, { name: d.name });
    return;
  }
  if (d.hash) selectCommitInLog(d.hash);
  else toast(d.name + ' points to a commit outside the loaded log', '');
}

function markTreeSelection(key) {
  document.querySelectorAll('#ref-tree .tree-item').forEach((r) => r.classList.toggle('selected', r.dataset.key === key));
}

function wireRefTree() {
  const el = $('#ref-tree');
  el.addEventListener('click', (ev) => {
    const head = ev.target.closest('.tree-head');
    if (head) {
      const g = head.dataset.group;
      if (treeClosed.has(g)) treeClosed.delete(g); else treeClosed.add(g);
      savePref('treeClosed', JSON.stringify([...treeClosed]));
      renderRefTree();
      return;
    }
    const item = ev.target.closest('.tree-item');
    if (item) onTreeClick(item, false);
  });
  el.addEventListener('dblclick', (ev) => {
    const item = ev.target.closest('.tree-item');
    if (item) onTreeClick(item, true);
  });
  el.addEventListener('keydown', (ev) => {
    const item = ev.target.closest('.tree-item');
    if (item && ev.key === 'Enter') onTreeClick(item, true);
  });
}
