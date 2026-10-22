'use strict';
// GitDeck Files view commands: the context menu for files and folders, and the
// file Log. What the menu offers follows the entry's state, as SmartGit's does:
// changed files stage / unstage / discard, untracked ones stage / ignore /
// delete, tracked ones remove / rename / toggle assume-unchanged and
// skip-worktree. Rev mode is read-only. Classic script: shares globals with
// app.js and files.js.

let filesMenuEl = null;

function closeFilesMenu() {
  if (!filesMenuEl) return;
  filesMenuEl.remove();
  filesMenuEl = null;
  document.removeEventListener('mousedown', filesMenuOutside, true);
}

function filesMenuOutside(ev) {
  if (filesMenuEl && !filesMenuEl.contains(ev.target)) closeFilesMenu();
}

// The menu items for one entry: [label, run, {danger}] or '-' for a separator.
function filesMenuItems(e) {
  const items = [];
  const sep = () => { if (items.length && items[items.length - 1] !== '-') items.push('-'); };
  const copy = (p) => ['Copy path', () => navigator.clipboard.writeText(p).then(() => toast('Copied ' + p, 'success'))];

  if (typeof e.dir === 'string') { // a folder row (an ignored folder entry has dir: true)
    const dir = e.dir;
    if (!filesState.rev) {
      items.push(['Stage folder', () => act('gd:stagePaths', 'Staged ' + dir, { paths: [dir] })]);
      items.push(['Ignore folder', () => filesIgnore([dir])]);
      sep();
      items.push(['Reveal in file manager', () => filesReveal(dir)]);
    }
    items.push(copy(dir));
    return items;
  }

  const p = e.path;
  if (filesState.rev) {
    items.push(['Blame', () => showBlame(p, () => showFileBrowserDetail(p, filesState.rev), filesState.rev)]);
    items.push(['Log', () => showFileLog(p, () => showFileBrowserDetail(p, filesState.rev))]);
    sep();
    items.push(copy(p));
    return items;
  }

  const kind = statusKindFor(p);
  const deleted = e.code === 'D';
  const tracked = e.state === 'tracked';
  if (e.cat === 'ignored') {
    items.push(['Delete…', () => filesTrash(p)]);
  } else if (e.cat === 'untracked') {
    items.push(['Stage', () => act('gd:stagePaths', 'Staged ' + p, { paths: [p] })]);
    items.push(['Ignore', () => filesIgnore([p])]);
    items.push(['Delete…', () => filesTrash(p), { danger: true }]);
  } else if (kind) {
    const st = state.status;
    if (kind === 'unstaged' || kind === 'conflicted') items.push(['Stage', () => act('gd:stagePaths', 'Staged ' + p, { paths: [p] })]);
    if (st.staged.some((x) => x.path === p)) items.push(['Unstage', () => act('gd:unstagePaths', 'Unstaged ' + p, { paths: [p] })]);
    if (kind !== 'conflicted') items.push(['Discard…', () => filesDiscard(p), { danger: true }]);
  }
  if (tracked) {
    sep();
    if (!deleted) items.push(['Rename / Move…', () => filesMove(p)]);
    items.push(['Remove…', () => filesRemove(p, false), { danger: true }]);
    if (!deleted) items.push(['Remove from index (keep file)', () => filesRemove(p, true)]);
    sep();
    items.push([(e.assume ? '✓ ' : '') + 'Assume unchanged', () => filesFlag(p, 'assume', !e.assume)]);
    items.push([(e.skip ? '✓ ' : '') + 'Skip worktree', () => filesFlag(p, 'skip', !e.skip)]);
    sep();
    const back = () => showFileBrowserDetail(p, null);
    if (!deleted) items.push(['Blame', () => showBlame(p, back, null)]);
    items.push(['Log', () => showFileLog(p, back)]);
  }
  sep();
  if (!deleted) items.push(['Reveal in file manager', () => filesReveal(p)]);
  items.push(copy(p));
  return items;
}

function openFilesMenu(x, y, entry) {
  closeFilesMenu();
  const items = filesMenuItems(entry);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  items.forEach((it) => {
    if (it === '-') { menu.insertAdjacentHTML('beforeend', '<div class="ctx-sep" role="separator"></div>'); return; }
    const b = document.createElement('button');
    b.className = 'ctx-item' + (it[2] && it[2].danger ? ' danger' : '');
    b.setAttribute('role', 'menuitem');
    b.textContent = it[0];
    b.onclick = () => {
      closeFilesMenu();
      Promise.resolve().then(it[1]).catch((err) => toast(err.message, 'error'));
    };
    menu.appendChild(b);
  });
  menu.onkeydown = (ev) => {
    const btns = [...menu.querySelectorAll('.ctx-item')];
    const i = btns.indexOf(document.activeElement);
    if (ev.key === 'Escape' || ev.key === 'Tab') { ev.preventDefault(); closeFilesMenu(); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
  };
  document.body.appendChild(menu);
  // Keep it on screen.
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  filesMenuEl = menu;
  document.addEventListener('mousedown', filesMenuOutside, true);
  const first = menu.querySelector('.ctx-item');
  if (first) first.focus();
}

// From the keyboard: open the menu under the focused row.
function openFilesMenuAt(row, entry) {
  const r = row.getBoundingClientRect();
  openFilesMenu(r.left + 24, r.bottom, entry);
}

window.addEventListener('blur', closeFilesMenu);
window.addEventListener('resize', closeFilesMenu);

// ---------- commands ----------
function filesIgnore(paths) {
  return act('gd:ignorePaths', 'Added to .gitignore: ' + paths.join(', '), { paths });
}

async function filesTrash(p) {
  if (!(await confirmDialog('Move ' + p + ' to the trash?', { title: 'Delete', ok: 'Delete', danger: true }))) return;
  return act('gd:trashFiles', 'Moved ' + p + ' to the trash', { paths: [p] });
}

async function filesDiscard(p) {
  if (!(await confirmDialog('Discard all changes to ' + p + '? This cannot be undone.', { ok: 'Discard', danger: true }))) return;
  return act('gd:discard', 'Discarded ' + p, { paths: [p] });
}

async function filesRemove(p, cached) {
  if (!cached && !(await confirmDialog('Remove ' + p + ' from the repository and delete it from disk? The removal is staged.',
    { title: 'Remove', ok: 'Remove', danger: true }))) return;
  return act('gd:removeFiles', cached ? 'Removed ' + p + ' from the index' : 'Removed ' + p, { paths: [p], cached });
}

async function filesMove(p) {
  const res = await formDialog({
    title: 'Rename / Move',
    note: 'A tracked file is moved with git mv, so the rename is staged.',
    ok: 'Rename',
    fields: [{ name: 'to', label: 'New path (relative to the repository)', value: p }],
    onOpen: (dlg) => { // select the file name, not the folders
      const input = dlg.querySelector('#fd-to');
      const slash = p.lastIndexOf('/') + 1;
      const dot = p.lastIndexOf('.');
      input.setSelectionRange(slash, dot > slash ? dot : p.length);
    },
  });
  const to = res && res.to.trim().replace(/\\/g, '/');
  if (!to || to === p) return;
  filesState.selected = to;
  return act('gd:moveFile', 'Moved ' + p + ' to ' + to, { from: p, to });
}

function filesFlag(p, flag, on) {
  const name = flag === 'assume' ? 'assume-unchanged' : 'skip-worktree';
  return act('gd:setFileFlag', (on ? 'Marked ' : 'Cleared ') + name + ': ' + p, { paths: [p], flag, on });
}

async function filesReveal(p) {
  try { await api('gd:revealFile', { repo: state.repo, path: p }); }
  catch (e) { toast(e.message, 'error'); }
}

// ---------- the file Log ----------
// The commits that changed one file, following renames; a click shows the commit.
async function showFileLog(path, back) {
  let commits;
  try { commits = await api('gd:fileLog', { repo: state.repo, path }); }
  catch (e) { toast(e.message, 'error'); return; }
  state.detailFiles = [];
  state.redrawDetail = null;
  const rows = commits.map((c) =>
    '<button class="flog-row" data-hash="' + esc(c.hash) + '" title="Show commit ' + esc(c.short) + '">' +
    '<span class="blame-hash">' + esc(c.short) + '</span>' +
    '<span class="flog-subject">' + esc(c.subject) + '</span>' +
    '<span class="flog-meta">' + esc(c.authorName) + ' · ' + esc(fmtDate(c.timestamp)) + '</span></button>').join('');
  detail('<div class="detail-header"><span class="title">' + esc(path) + '</span>' +
    '<span class="detail-label">Log · ' + commits.length + (commits.length === 1 ? ' commit' : ' commits') + '</span>' +
    '<button class="btn btn-sm" id="act-flog-back">Back</button></div>' +
    (rows ? '<div class="flog-list">' + rows + '</div>' : '<div class="diff-empty">No commits touch this file yet</div>'));
  $('#act-flog-back').onclick = back;
  document.querySelectorAll('.flog-row').forEach((b) => { b.onclick = () => selectCommitInLog(b.dataset.hash); });
}
