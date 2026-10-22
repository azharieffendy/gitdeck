'use strict';
// GitDeck sidebar tree: local branches, remote branches, tags and stashes.
// Click selects the ref's commit in the log; double-click a local branch to switch
// to it, a stash to open it. Classic script: shares globals with app.js.

// Collapsed groups and each group's dragged height (px; none = fit its items).
// Read on the first render: app.js (loadPref) loads after this script.
const treeClosed = new Set();
const treeHeights = {};
let treePrefsLoaded = false;
const TREE_MIN_HEIGHT = 24;

function loadTreePrefs() {
  if (treePrefsLoaded) return;
  treePrefsLoaded = true;
  try { JSON.parse(loadPref('treeClosed', '[]')).forEach((g) => treeClosed.add(g)); } catch { /* keep defaults */ }
  try { Object.assign(treeHeights, JSON.parse(loadPref('treeHeights', '{}'))); } catch { /* keep defaults */ }
}

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
    (open ? '<div class="tree-items" data-group="' + key + '">' + (items.join('') || '<div class="tree-empty">None</div>') + '</div>' +
      '<div class="tree-grip" data-group="' + key + '" tabindex="0" role="separator" aria-orientation="horizontal" aria-label="Resize ' +
      esc(label) + '" title="Drag to resize ' + esc(label) + ' (double-click to fit)"></div>' : '') + '</div>';
}

// Give each resized group its height; the list scrolls inside it.
function applyTreeHeights() {
  document.querySelectorAll('#ref-tree .tree-items').forEach((el) => {
    const h = treeHeights[el.dataset.group];
    el.style.height = h ? h + 'px' : '';
    el.classList.toggle('sized', !!h);
  });
}

function setTreeHeight(group, h) {
  const el = document.querySelector('#ref-tree .tree-items[data-group="' + group + '"]');
  if (!el) return;
  // No taller than the items themselves: past that it would only add empty space.
  const natural = [...el.children].reduce((sum, c) => sum + c.offsetHeight, 0);
  const fitted = Math.round(Math.max(TREE_MIN_HEIGHT, Math.min(h, natural)));
  if (fitted >= natural) delete treeHeights[group]; else treeHeights[group] = fitted;
  applyTreeHeights();
}

function wireTreeGrips() {
  document.querySelectorAll('#ref-tree .tree-grip').forEach((grip) => {
    const group = grip.dataset.group;
    const items = () => document.querySelector('#ref-tree .tree-items[data-group="' + group + '"]');
    grip.onpointerdown = (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      grip.setPointerCapture(ev.pointerId);
      const startY = ev.clientY;
      const startH = items().offsetHeight;
      document.body.classList.add('resizing-row');
      grip.classList.add('active');
      grip.onpointermove = (e) => setTreeHeight(group, startH + e.clientY - startY);
      grip.onpointerup = grip.onpointercancel = () => {
        grip.onpointermove = grip.onpointerup = grip.onpointercancel = null;
        document.body.classList.remove('resizing-row');
        grip.classList.remove('active');
        savePref('treeHeights', JSON.stringify(treeHeights));
      };
    };
    grip.onkeydown = (ev) => {
      const dir = { ArrowUp: -1, ArrowDown: 1 }[ev.key];
      if (!dir) return;
      ev.preventDefault();
      setTreeHeight(group, items().offsetHeight + dir * (ev.shiftKey ? 96 : 24));
      savePref('treeHeights', JSON.stringify(treeHeights));
    };
    grip.ondblclick = () => {
      delete treeHeights[group];
      applyTreeHeights();
      savePref('treeHeights', JSON.stringify(treeHeights));
    };
  });
}

function renderRefTree() {
  const el = $('#ref-tree');
  if (!el) return;
  if (!state.repo) { el.innerHTML = ''; return; }
  loadTreePrefs();
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
  applyTreeHeights();
  wireTreeGrips();
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
