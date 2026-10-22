'use strict';
// GitDeck Files view: every file in the repository, not just the changed ones
// (SmartGit's Files view). A directory pane on top picks a folder; the file list
// below shows that folder's files (and its subfolders' when enabled). Working-tree
// mode classifies each file (changed, unchanged, untracked, ignored,
// assume-unchanged / skip-worktree) and filters by state and by name; a name match
// always shows, dimmed when its state is hidden. Rev mode browses the complete
// tree of any commit, read-only. Commands and the context menu live in
// files-actions.js, the folder commit box in files-commit.js. Classic script:
// shares globals with app.js.

const FILES_LINE_CAP = 3000;
const FILES_FLAT_CAP = 2000;
const FILES_DIRS_DEFAULT = 200;
const FILES_DIRS_MIN = 48;
const FILES_LIST_MIN = 96;
const FILES_STATES = [
  ['changed', 'Changed', 'Modified, added, deleted and conflicted files'],
  ['unchanged', 'Unchanged', 'Tracked files without changes'],
  ['untracked', 'Untracked', 'Files git does not track yet'],
  ['ignored', 'Ignored', 'Files matched by .gitignore (ignored folders are not scanned)'],
  ['flagged', 'Assume/Skip', 'Files marked assume-unchanged or skip-worktree'],
];

// Filled from the saved prefs on the first render: app.js (loadPref) loads after this script.
const filesPrefs = {
  loaded: false,
  show: { changed: true, unchanged: true, untracked: true, ignored: false, flagged: false },
  regex: false,
  sub: true,        // the file list includes the selected folder's subfolders
  dirsHeight: FILES_DIRS_DEFAULT,
  patterns: [],
};

// Collapsed folders in the directory pane, remembered like the sidebar's ref tree.
const filesClosed = new Set();

function loadFilesPrefs() {
  if (filesPrefs.loaded) return;
  const parse = (key, fallback) => { try { return JSON.parse(loadPref(key, '')) || fallback; } catch { return fallback; } };
  Object.assign(filesPrefs.show, parse('filesShow', {}));
  filesPrefs.regex = loadPref('filesRegex', '') === '1';
  filesPrefs.sub = loadPref('filesSub', '1') === '1';
  filesPrefs.dirsHeight = parseInt(loadPref('filesDirsH', ''), 10) || FILES_DIRS_DEFAULT;
  filesPrefs.patterns = parse('filesPatterns', []);
  for (const d of parse('filesClosed', [])) filesClosed.add(d);
  filesPrefs.loaded = true;
}

const filesState = {
  repo: null,       // the repository the cached list belongs to
  rev: null,        // commit whose tree is being browsed, or null for the working tree
  filter: '',
  data: null,       // {rev, ignored, truncated, files: [{path, state?, assume?, skip?, dir?, size?}]}
  dirty: true,      // refetch on the next render
  dir: '',          // folder chosen in the directory pane; '' is the repository root
  unpicked: new Set(), // changed files unticked for the folder commit
  selected: '',
  lastDetail: '',   // path@rev of the file in the detail pane (resets Show-all)
  showAllLines: false,
};

function saveFilesPrefs() {
  savePref('filesShow', JSON.stringify(filesPrefs.show));
  savePref('filesRegex', filesPrefs.regex ? '1' : '');
  savePref('filesSub', filesPrefs.sub ? '1' : '0');
  savePref('filesDirsH', String(filesPrefs.dirsHeight));
  savePref('filesPatterns', JSON.stringify(filesPrefs.patterns));
}

function markFilesDirty() { filesState.dirty = true; }

// From a commit's detail pane: browse the repository as of that commit.
function browseFilesAt(hash) {
  filesState.rev = hash;
  filesState.selected = '';
  filesState.dirty = true;
  setView('files');
}

function exitFilesRev() {
  filesState.rev = null;
  filesState.selected = '';
  filesState.dirty = true;
  setView('files');
}

// ---------- data shaping ----------
// path -> change code, so working-tree mode shows the same badges as the worktree view.
function filesStatusMap() {
  const m = new Map();
  const st = state.status;
  if (!st) return m;
  for (const e of st.conflicted) if (!m.has(e.path)) m.set(e.path, 'U');
  for (const e of st.staged) if (!m.has(e.path)) m.set(e.path, e.x || 'M');
  for (const e of st.unstaged) if (!m.has(e.path)) m.set(e.path, e.y || 'M');
  for (const e of st.untracked) if (!m.has(e.path)) m.set(e.path, '?');
  return m;
}

// Which working-tree section a path belongs to, for the Diff button. Unstaged
// wins over staged: it is the change still on disk.
function statusKindFor(path) {
  const st = state.status;
  if (!st) return null;
  if (st.conflicted.some((e) => e.path === path)) return 'conflicted';
  if (st.untracked.some((e) => e.path === path)) return 'untracked';
  if (st.unstaged.some((e) => e.path === path)) return 'unstaged';
  if (st.staged.some((e) => e.path === path)) return 'staged';
  return null;
}

// Every entry with its code and display category. Staged deletions are not in
// the index any more, so they are added from the status.
function filesEntries(statusMap) {
  const files = filesState.data.files;
  if (filesState.rev) return files.map((f) => Object.assign({ cat: 'unchanged', code: '' }, f));
  const seen = new Set(files.map((f) => f.path));
  const out = files.map((f) => {
    const code = f.state === 'ignored' ? '' : statusMap.get(f.path) || '';
    let cat = f.state === 'ignored' ? 'ignored' : f.state === 'untracked' ? 'untracked' : code ? 'changed' : 'unchanged';
    if (cat === 'unchanged' && (f.assume || f.skip)) cat = 'flagged';
    return Object.assign({ cat, code }, f);
  });
  for (const [p, code] of statusMap) {
    if (!seen.has(p) && code !== '?') out.push({ path: p, state: 'tracked', cat: 'changed', code });
  }
  return out;
}

// The name filter: substring by default, a regular expression when enabled.
// Returns null for no filter, or a test function; an invalid expression matches nothing.
function filesNameTest() {
  const q = filesState.filter.trim();
  if (!q) return null;
  if (filesPrefs.regex) {
    try { const re = new RegExp(q, 'i'); return (p) => re.test(p); }
    catch { return () => false; }
  }
  const lq = q.toLowerCase();
  return (p) => p.toLowerCase().includes(lq);
}

const shownByState = (e) => !!filesState.rev || !!filesPrefs.show[e.cat];

// Is the entry in the chosen folder (directly, or anywhere below it with subfolders on)?
function inFilesScope(e) {
  const rel = e.path.replace(/\/$/, '');
  const dir = filesState.dir;
  if (dir && !rel.startsWith(dir + '/')) return false;
  return filesPrefs.sub || !rel.slice(dir ? dir.length + 1 : 0).includes('/');
}

// SmartGit's rule: a name match shows even when its state is hidden (dimmed).
function visibleEntries(entries) {
  const test = filesNameTest();
  const out = [];
  for (const e of entries) {
    if (!inFilesScope(e)) continue;
    const byState = shownByState(e);
    if (test) { if (test(e.path)) out.push(Object.assign({ dim: !byState }, e)); }
    else if (byState) out.push(e);
  }
  return out;
}

function buildFileTree(entries) {
  const root = { dirs: new Map(), files: [] };
  for (const e of entries) {
    const parts = e.path.replace(/\/$/, '').split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { name: parts[i], dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push(e);
  }
  return root;
}

// A folder's summary: file count and its most important state (conflict, change, untracked).
const DIR_RANK = { U: 3, changed: 2, untracked: 1 };
function dirSummary(node) {
  let count = node.files.length;
  let rank = 0;
  for (const e of node.files) rank = Math.max(rank, e.code === 'U' ? 3 : DIR_RANK[e.cat] || 0);
  for (const d of node.dirs.values()) {
    const s = dirSummary(d);
    count += s.count;
    rank = Math.max(rank, s.rank);
  }
  return { count, rank };
}

function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---------- rendering ----------
const CAT_LABELS = { ignored: 'ignored', untracked: '', changed: '', unchanged: '' };
function entryNote(e) {
  if (e.assume && e.skip) return 'assume, skip';
  if (e.assume) return 'assume unchanged';
  if (e.skip) return 'skip worktree';
  return CAT_LABELS[e.cat] || '';
}

// A change the folder commit can take: conflicts must be resolved first, and
// an ignored folder is not a file.
function isCommittable(e) {
  return !filesState.rev && (e.cat === 'changed' || e.cat === 'untracked') && e.code !== 'U' && !e.path.endsWith('/');
}

// One file in the list; its folder is shown relative to the chosen folder.
function fileTreeRow(e) {
  const p = e.path;
  const rel = p.replace(/\/$/, '');
  const inner = dirPart(filesState.dir ? rel.slice(filesState.dir.length + 1) : rel);
  const badge = e.code ? badgeFor(e.code) : '';
  const cls = ' ft-' + e.cat + (e.dim ? ' ft-dim' : '') + (filesState.selected === p ? ' selected' : '');
  const pick = isCommittable(e)
    ? '<input type="checkbox" class="ft-pick" title="Include in the folder commit"' + (filesState.unpicked.has(p) ? '' : ' checked') + '>'
    : '';
  const note = entryNote(e);
  return '<div class="ft-row ft-file' + cls + '" data-path="' + esc(p) + '" tabindex="0" title="' + esc(p) + '">' + pick +
    '<svg class="ft-icon"><use href="' + (e.dir ? '#i-open' : '#i-files') + '"/></svg>' +
    '<span class="ft-name"><span class="dir">' + esc(inner) + '</span>' + esc(basePart(rel)) + (e.dir ? '/' : '') + '</span>' +
    (note ? '<span class="ft-note">' + esc(note) + '</span>' : '') + badge + '</div>';
}

const DIR_BADGE = { 3: 'U', 2: 'M', 1: '?' };
const CARET = '<svg class="tree-caret" viewBox="0 0 10 10"><path d="M3 1.5l4 3.5-4 3.5z"/></svg>';

// Changed (and untracked) files below a folder, for its count in the directory pane.
function dirChanges(node) {
  let n = node.files.filter((e) => e.cat === 'changed' || e.cat === 'untracked').length;
  for (const d of node.dirs.values()) n += dirChanges(d);
  return n;
}

function dirRowHtml(full, name, node, depth) {
  const hasKids = node.dirs.size > 0;
  const open = hasKids && (full === '' || !filesClosed.has(full));
  const s = dirSummary(node);
  const changes = filesState.rev ? 0 : dirChanges(node);
  return '<div class="ft-row ft-dir fd-row' + (open ? ' open' : '') + (hasKids ? '' : ' leaf') +
    (filesState.dir === full ? ' selected' : '') + '" data-dir="' + esc(full) + '" tabindex="0" role="treeitem"' +
    (hasKids ? ' aria-expanded="' + open + '"' : '') + ' style="padding-left:' + (8 + depth * 14) + 'px">' + CARET +
    '<svg class="ft-icon"><use href="#i-open"/></svg><span class="ft-name">' + esc(name) + '</span>' +
    (changes ? '<span class="fd-changes" title="' + changes + ' changed file(s)">' + changes + '</span>' : '') +
    '<span class="ft-aux" title="' + s.count + ' file(s)">' + s.count + '</span>' +
    (s.rank ? badgeFor(DIR_BADGE[s.rank]) : '') + '</div>';
}

function renderDirNode(prefix, node, depth) {
  let html = '';
  for (const d of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const full = prefix ? prefix + '/' + d.name : d.name;
    html += dirRowHtml(full, d.name, d, depth);
    if (d.dirs.size && !filesClosed.has(full)) html += renderDirNode(full, d, depth + 1);
  }
  return html;
}

// The directory pane: the repository root, then its folders.
function dirsPaneHtml(root) {
  const name = basePart(state.repo.replace(/[\\/]+$/, '').replace(/\\/g, '/')) || state.repo;
  return dirRowHtml('', name, root, 0) + renderDirNode('', root, 1);
}

// The chosen folder may be gone (committed, filtered out): fall back to its nearest parent.
function settleFilesDir(root) {
  let dir = filesState.dir;
  const exists = (d) => {
    let node = root;
    for (const part of d.split('/')) { node = node.dirs.get(part); if (!node) return false; }
    return true;
  };
  while (dir && !exists(dir)) dir = dirPart(dir).replace(/\/$/, '');
  filesState.dir = dir;
}

function filesBodyHtml(shown) {
  if (!shown.length) {
    const q = filesState.filter.trim();
    const where = filesState.dir ? ' in ' + esc(filesState.dir) + '/' : '';
    return '<div class="tree-empty files-flat-empty">' +
      (q ? 'No files match &ldquo;' + esc(q) + '&rdquo;' + where : 'No files to show' + where + ': turn on more states above') + '</div>';
  }
  const rows = shown.sort((a, b) => a.path.localeCompare(b.path));
  return rows.slice(0, FILES_FLAT_CAP).map(fileTreeRow).join('') +
    (rows.length > FILES_FLAT_CAP ? '<div class="tree-empty files-trunc">Showing the first ' + FILES_FLAT_CAP +
      ' of ' + rows.length + ' files; pick a folder or narrow the filter.</div>' : '');
}

// Tint like SmartGit: reddish when changed files are hidden, yellowish while a name filter is active.
function filesTint(entries) {
  if (filesState.filter.trim()) return 'tint-filter';
  if (!filesState.rev && !filesPrefs.show.changed && entries.some((e) => e.cat === 'changed')) return 'tint-hidden';
  return '';
}

// Redraw the directory pane and the file list (not the bar or the commit message).
function renderFilesTreeOnly() {
  const entries = filesEntries(filesStatusMap());
  const root = buildFileTree(entries.filter(shownByState));
  settleFilesDir(root);
  const dirs = $('#files-dirs');
  dirs.innerHTML = dirsPaneHtml(root);
  const shown = visibleEntries(entries);
  const tree = $('#files-tree');
  tree.className = 'files-tree ' + filesTint(entries);
  tree.innerHTML = filesBodyHtml(shown);
  const input = $('#files-filter');
  if (input) input.classList.toggle('invalid', filesPrefs.regex && !!filesState.filter.trim() && !isValidRegex(filesState.filter.trim()));
  const count = $('#files-count');
  if (count) count.textContent = shown.length + ' / ' + entries.length + (filesState.data.truncated ? '+' : '');
  const scope = $('#files-scope');
  if (scope) scope.textContent = filesState.dir ? filesState.dir + '/' : 'All folders';
  wireFilesTree();
  updateFilesCommit(shown);
}

function isValidRegex(s) { try { new RegExp(s); return true; } catch { return false; } }

function filesBarHtml() {
  const rev = filesState.rev;
  const chip = (id, label, title, on) => '<button class="chip' + (on ? ' on' : '') + '" id="' + id +
    '" aria-pressed="' + on + '" title="' + esc(title) + '">' + label + '</button>';
  const remembered = filesPrefs.patterns.includes(filesState.filter.trim());
  let html = '<div class="files-bar">' +
    '<input id="files-filter" list="files-patterns" placeholder="Filter files (Ctrl+F)" spellcheck="false" autocomplete="off" value="' + esc(filesState.filter) + '">' +
    '<datalist id="files-patterns">' + filesPrefs.patterns.map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist>' +
    chip('files-regex', '.*', 'Regular expression', filesPrefs.regex) +
    chip('files-remember', remembered ? '★' : '☆', remembered ? 'Forget this pattern' : 'Remember this pattern', remembered) +
    chip('files-sub', 'Subfolders', 'Also list the files in the chosen folder’s subfolders', filesPrefs.sub) +
    '<span class="files-count" id="files-count"></span></div>';
  html += '<div class="files-bar files-states">';
  if (rev) {
    html += '<span class="files-rev" title="Browsing the tree of ' + esc(rev) + '">at ' + esc(rev.slice(0, 8)) + ' (read-only)</span>' +
      '<button class="btn btn-sm" id="files-exit-rev" title="Back to the files on disk">Working tree</button>';
  } else {
    html += FILES_STATES.map(([k, label, title]) => chip('files-show-' + k, label, 'Show ' + title.toLowerCase(), filesPrefs.show[k])).join('') +
      '<button class="btn btn-sm files-ignore-edit" id="files-edit-ignore" title="Edit the top-level .gitignore">.gitignore</button>';
  }
  return html + '</div>';
}

async function renderFiles() {
  if (!state.repo) return;
  loadFilesPrefs();
  if (filesState.repo !== state.repo) { // switched repository (tab): start fresh
    filesState.repo = state.repo;
    filesState.rev = null;
    filesState.selected = '';
    filesState.dir = '';
    filesState.unpicked.clear();
    filesState.dirty = true;
  }
  const wantIgnored = !filesState.rev && filesPrefs.show.ignored;
  const d = filesState.data;
  if (filesState.dirty || !d || d.rev !== (filesState.rev || null) || (!d.rev && d.ignored !== wantIgnored)) {
    try {
      const data = await api('gd:listFiles', { repo: state.repo, rev: filesState.rev || null, ignored: wantIgnored });
      filesState.data = Object.assign({ ignored: wantIgnored }, data);
      filesState.dirty = false;
    } catch (e) { toast(e.message, 'error'); return; }
  }
  $('#list-pane').innerHTML = '<div class="files-view">' + filesBarHtml() +
    '<div class="files-pane-head">Directories</div>' +
    '<div class="files-dirs" id="files-dirs" role="tree" aria-label="Directories" style="height:' + filesPrefs.dirsHeight + 'px"></div>' +
    '<div class="files-grip" id="files-grip" tabindex="0" role="separator" aria-orientation="horizontal" aria-label="Resize the directory pane"' +
    ' title="Drag to resize the directory pane (double-click to reset)"></div>' +
    '<div class="files-pane-head">Files <span class="files-scope" id="files-scope"></span></div>' +
    '<div class="files-tree" id="files-tree"></div>' +
    (filesState.data.truncated ? '<div class="tree-empty files-trunc">Showing the first 50,000 files.</div>' : '') +
    filesCommitHtml() + '</div>';
  fitFilesDirs();
  renderFilesTreeOnly();
  wireFilesBar();
  wireFilesGrip();
  wireFilesCommit();
}

// Keep the directory pane within the view, leaving room for the file list.
function fitFilesDirs(h) {
  const view = $('#list-pane .files-view');
  const dirs = $('#files-dirs');
  if (!view || !dirs) return;
  const others = view.clientHeight - dirs.offsetHeight - $('#files-tree').offsetHeight;
  const max = Math.max(FILES_DIRS_MIN, view.clientHeight - others - FILES_LIST_MIN);
  const want = Math.round(Math.max(FILES_DIRS_MIN, Math.min(h == null ? filesPrefs.dirsHeight : h, max)));
  dirs.style.height = want + 'px';
  if (h != null) filesPrefs.dirsHeight = want;
}

function wireFilesGrip() {
  const grip = $('#files-grip');
  const save = () => savePref('filesDirsH', String(filesPrefs.dirsHeight));
  grip.onpointerdown = (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    const startY = ev.clientY;
    const startH = $('#files-dirs').offsetHeight;
    document.body.classList.add('resizing-row');
    grip.classList.add('active');
    grip.onpointermove = (e) => fitFilesDirs(startH + e.clientY - startY);
    grip.onpointerup = grip.onpointercancel = () => {
      grip.onpointermove = grip.onpointerup = grip.onpointercancel = null;
      document.body.classList.remove('resizing-row');
      grip.classList.remove('active');
      save();
    };
  };
  grip.onkeydown = (ev) => {
    const dir = { ArrowUp: -1, ArrowDown: 1 }[ev.key];
    if (!dir) return;
    ev.preventDefault();
    fitFilesDirs($('#files-dirs').offsetHeight + dir * (ev.shiftKey ? 96 : 24));
    save();
  };
  grip.ondblclick = () => { fitFilesDirs(FILES_DIRS_DEFAULT); save(); };
}

function wireFilesBar() {
  const filter = $('#files-filter');
  filter.oninput = () => {
    filesState.filter = filter.value;
    const rem = $('#files-remember');
    const on = filesPrefs.patterns.includes(filter.value.trim());
    rem.textContent = on ? '★' : '☆';
    rem.classList.toggle('on', on);
    rem.title = on ? 'Forget this pattern' : 'Remember this pattern';
    renderFilesTreeOnly();
  };
  filter.onkeydown = (ev) => { if (ev.key === 'Escape' && filter.value) { filter.value = ''; filter.oninput(); } };
  const toggle = (id, fn) => { const b = $('#' + id); if (b) b.onclick = () => { fn(); saveFilesPrefs(); renderFiles(); }; };
  toggle('files-regex', () => { filesPrefs.regex = !filesPrefs.regex; });
  toggle('files-sub', () => { filesPrefs.sub = !filesPrefs.sub; });
  toggle('files-remember', () => {
    const q = filesState.filter.trim();
    if (!q) return;
    const i = filesPrefs.patterns.indexOf(q);
    filesPrefs.patterns = i === -1 ? [q, ...filesPrefs.patterns].slice(0, 20) : filesPrefs.patterns.filter((p) => p !== q);
  });
  for (const [k] of FILES_STATES) toggle('files-show-' + k, () => { filesPrefs.show[k] = !filesPrefs.show[k]; });
  const exit = $('#files-exit-rev');
  if (exit) exit.onclick = exitFilesRev;
  const ign = $('#files-edit-ignore');
  if (ign) ign.onclick = () => showEditor('.gitignore', () => renderFiles());
}

function filesEntryFor(path) {
  return filesEntries(filesStatusMap()).find((e) => e.path === path) || { path, cat: 'unchanged', code: '' };
}

const focusDirRow = (dir) => {
  const row = document.querySelector('#files-dirs .fd-row[data-dir="' + CSS.escape(dir) + '"]');
  if (row) row.focus();
};

// Choose the folder whose files the list shows.
function chooseFilesDir(dir) {
  if (filesState.dir !== dir) {
    filesState.dir = dir;
    filesState.selected = '';
  }
  renderFilesTreeOnly();
  focusDirRow(dir);
}

function toggleFilesDir(dir, open) {
  if (!dir) return; // the root always stays open
  if (open === undefined) open = filesClosed.has(dir);
  if (open) filesClosed.delete(dir); else filesClosed.add(dir);
  savePref('filesClosed', JSON.stringify([...filesClosed]));
  renderFilesTreeOnly();
  focusDirRow(dir);
}

function wireFilesTree() {
  const dirRows = [...document.querySelectorAll('#files-dirs .fd-row')];
  dirRows.forEach((row, i) => {
    const dir = row.dataset.dir;
    row.onclick = (ev) => {
      if (ev.target.closest('.tree-caret')) toggleFilesDir(dir);
      else chooseFilesDir(dir);
    };
    row.ondblclick = (ev) => { if (!ev.target.closest('.tree-caret')) toggleFilesDir(dir); };
    row.onkeydown = (ev) => {
      const k = ev.key;
      if (k === 'Enter' || k === ' ') { ev.preventDefault(); chooseFilesDir(dir); }
      else if (k === 'ArrowDown' || k === 'ArrowUp') {
        ev.preventDefault();
        const next = dirRows[i + (k === 'ArrowDown' ? 1 : -1)];
        if (next) chooseFilesDir(next.dataset.dir);
      } else if (k === 'ArrowRight' && !row.classList.contains('leaf') && !row.classList.contains('open')) { ev.preventDefault(); toggleFilesDir(dir, true); }
      else if (k === 'ArrowLeft') {
        ev.preventDefault();
        if (row.classList.contains('open') && dir) toggleFilesDir(dir, false);
        else if (dir) chooseFilesDir(dirPart(dir).replace(/\/$/, ''));
      } else if (dir && (k === 'ContextMenu' || (ev.shiftKey && k === 'F10'))) { ev.preventDefault(); openFilesMenuAt(row, { dir }); }
    };
    row.oncontextmenu = (ev) => { ev.preventDefault(); if (dir) openFilesMenu(ev.clientX, ev.clientY, { dir }); };
  });
  document.querySelectorAll('#files-tree .ft-pick').forEach((box) => {
    box.onclick = (ev) => {
      ev.stopPropagation();
      const p = box.closest('.ft-file').dataset.path;
      if (box.checked) filesState.unpicked.delete(p); else filesState.unpicked.add(p);
      updateFilesCommit();
    };
    box.onkeydown = (ev) => ev.stopPropagation();
  });
  document.querySelectorAll('#files-tree .ft-file').forEach((row) => {
    const select = () => {
      filesState.selected = row.dataset.path;
      document.querySelectorAll('#files-tree .ft-file').forEach((r) => r.classList.toggle('selected', r === row));
    };
    const open = () => {
      select();
      if (row.dataset.path.endsWith('/')) return; // an ignored folder: nothing to read
      showFileBrowserDetail(row.dataset.path, filesState.rev);
    };
    row.onclick = open;
    row.onkeydown = (ev) => {
      if (ev.key === 'Enter') open();
      else if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) { ev.preventDefault(); select(); openFilesMenuAt(row, filesEntryFor(row.dataset.path)); }
    };
    row.oncontextmenu = (ev) => { ev.preventDefault(); select(); openFilesMenu(ev.clientX, ev.clientY, filesEntryFor(row.dataset.path)); };
  });
}

// Ctrl+F in the Files view focuses its filter, as in SmartGit.
document.addEventListener('keydown', (ev) => {
  if (state.view !== 'files' || !(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'f') return;
  const f = $('#files-filter');
  if (f) { ev.preventDefault(); f.focus(); f.select(); }
});

// ---------- the detail pane ----------
async function showFileBrowserDetail(path, rev) {
  let info;
  try { info = await api('gd:readFileAt', { repo: state.repo, path, rev: rev || null }); }
  catch (e) { toast(e.message, 'error'); return; }
  const key = path + '@' + (rev || 'wt');
  if (filesState.lastDetail !== key) { filesState.lastDetail = key; filesState.showAllLines = false; }

  const btn = (id, label, title) => '<button class="btn btn-sm" id="' + id + '" title="' + esc(title) + '">' + label + '</button>';
  const kind = rev ? null : statusKindFor(path);
  let tools = btn('act-fv-blame', 'Blame', 'Who last changed each line') + btn('act-fv-log', 'Log', 'Commits that changed this file');
  if (kind) tools += btn('act-fv-diff', 'Diff', 'Show this file’s changes');
  if (!rev) tools += btn('act-fv-edit', 'Edit', 'Edit the working-tree file');
  else tools += btn('act-fv-commit', 'Show commit', 'Select this commit in the log');

  let body;
  if (info.binary) body = '<div class="diff-empty">Binary file (' + fmtSize(info.size) + ')</div>';
  else if (info.size === 0) body = '<div class="diff-empty">Empty file</div>';
  else {
    const lines = info.content.split('\n');
    if (info.content.endsWith('\n')) lines.pop(); // the final newline is not a line
    const shown = filesState.showAllLines ? lines : lines.slice(0, FILES_LINE_CAP);
    body = (info.truncated ? '<div class="diff-empty">Showing the first 2 MB of a ' + fmtSize(info.size) + ' file</div>' : '') +
      '<div class="fv-table">' + shown.map((l, i) =>
        '<div class="fv-row"><span class="diff-no">' + (i + 1) + '</span><span class="diff-text">' + esc(l || ' ') + '</span></div>').join('') + '</div>' +
      (lines.length > shown.length
        ? '<div class="diff-empty">' + (lines.length - shown.length) + ' more lines <button class="btn btn-sm" id="act-fv-all">Show all</button></div>'
        : '');
  }

  state.detailFiles = [];
  state.redrawDetail = null;
  detail('<div class="detail-header"><span class="title">' + esc(path) + '</span>' +
    '<span class="detail-label">' + (rev ? 'at ' + esc(rev.slice(0, 8)) : 'working tree') + '</span>' +
    '<span class="fv-size">' + fmtSize(info.size) + '</span>' + tools + '</div>' + body);
  const back = () => showFileBrowserDetail(path, rev);
  $('#act-fv-blame').onclick = () => showBlame(path, back, rev || null);
  $('#act-fv-log').onclick = () => showFileLog(path, back);
  const diffB = $('#act-fv-diff');
  if (diffB) diffB.onclick = () => showFileDetail(kind, path);
  const editB = $('#act-fv-edit');
  if (editB) editB.onclick = () => showEditor(path, back);
  const commitB = $('#act-fv-commit');
  if (commitB) commitB.onclick = () => selectCommitInLog(rev);
  const allB = $('#act-fv-all');
  if (allB) allB.onclick = () => { filesState.showAllLines = true; back(); };
}
