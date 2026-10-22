'use strict';
// GitDeck Files view: the commit box under the file list. It commits the ticked
// changes the list shows for the chosen folder, and only those (git commit --only):
// changes elsewhere, staged or not, stay as they are. The message and Amend are
// shared with the working-tree view. Classic script: shares globals with app.js.

function filesCommitHtml() {
  if (filesState.rev) return '';
  return '<div class="commit-box files-commit" id="files-commit">' +
    '<textarea id="files-commit-msg" spellcheck="true" placeholder="Commit message for the chosen folder">' + esc(state.commitDraft) + '</textarea>' +
    '<div class="commit-row">' +
    '<label class="check" title="Tick or untick every change listed"><input type="checkbox" id="files-pick-all"> All</label>' +
    '<label class="check"><input type="checkbox" id="files-commit-amend"' + (state.amend ? ' checked' : '') + '> Amend</label>' +
    '<span class="commit-hint" id="files-commit-hint"></span>' +
    '<button class="btn btn-primary" id="act-files-commit" disabled>Commit</button>' +
    '</div></div>';
}

// The changes the list offers, the ones ticked, and conflicts that block a commit.
function filesCommitPicks(shown) {
  const list = shown || visibleEntries(filesEntries(filesStatusMap()));
  const candidates = list.filter(isCommittable);
  return {
    candidates,
    picked: candidates.filter((e) => !filesState.unpicked.has(e.path)),
    conflicts: list.filter((e) => e.code === 'U').length,
  };
}

function updateFilesCommit(shown) {
  const hint = $('#files-commit-hint');
  if (!hint) return;
  const { candidates, picked, conflicts } = filesCommitPicks(shown);
  const where = filesState.dir ? filesState.dir + '/' : 'the repository';
  hint.textContent = conflicts ? conflicts + ' conflicted file(s) in ' + where + ': resolve them first'
    : candidates.length ? picked.length + ' of ' + candidates.length + ' change(s) in ' + where
      : 'No changes listed in ' + where;
  hint.title = hint.textContent;
  const all = $('#files-pick-all');
  all.disabled = !candidates.length;
  all.checked = candidates.length > 0 && picked.length === candidates.length;
  all.indeterminate = picked.length > 0 && picked.length < candidates.length;
  const btn = $('#act-files-commit');
  btn.disabled = !picked.length;
  btn.textContent = (state.amend ? 'Amend' : 'Commit') + (picked.length ? ' ' + picked.length : '');
}

function wireFilesCommit() {
  const msg = $('#files-commit-msg');
  if (!msg) return;
  msg.oninput = () => { state.commitDraft = msg.value; };
  msg.onkeydown = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); commitFilesDir(); }
  };
  $('#files-commit-amend').onchange = async (ev) => {
    state.amend = ev.target.checked;
    // Amending starts from the previous message, as in the working-tree view.
    if (state.amend && !state.commitDraft.trim()) {
      try { state.commitDraft = await api('gd:lastMessage', { repo: state.repo }); } catch (e) { toast(e.message, 'error'); }
      msg.value = state.commitDraft;
    }
    updateFilesCommit();
  };
  $('#files-pick-all').onchange = (ev) => {
    const { candidates } = filesCommitPicks();
    for (const e of candidates) {
      if (ev.target.checked) filesState.unpicked.delete(e.path); else filesState.unpicked.add(e.path);
    }
    document.querySelectorAll('#files-tree .ft-pick').forEach((box) => { box.checked = ev.target.checked; });
    updateFilesCommit();
  };
  $('#act-files-commit').onclick = commitFilesDir;
}

async function commitFilesDir() {
  const msg = $('#files-commit-msg').value;
  const { picked, conflicts } = filesCommitPicks();
  if (conflicts) { toast('Resolve the conflicted files first', 'error'); return; }
  if (!picked.length) { toast('Tick the changes to commit', 'error'); return; }
  if (!msg.trim()) { toast('Write a commit message first', 'error'); $('#files-commit-msg').focus(); return; }
  // A staged rename commits as one change: take its old path along with the new one.
  const paths = new Set(picked.map((e) => e.path));
  for (const e of (state.status ? state.status.staged : [])) if (e.oldPath && paths.has(e.path)) paths.add(e.oldPath);
  const untracked = picked.filter((e) => e.cat === 'untracked').map((e) => e.path);
  const btn = $('#act-files-commit');
  btn.disabled = true;
  try {
    const res = await api('gd:commitPaths', { repo: state.repo, message: msg, paths: [...paths], untracked, amend: state.amend });
    state.commitDraft = '';
    state.amend = false;
    filesState.unpicked.clear();
    toast((res.head ? 'Committed ' + res.head.short : 'Committed') + ' (' + picked.length + ' file(s))', 'success');
    await refreshAll();
    await prefillTemplate();
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false;
  }
}
