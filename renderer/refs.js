'use strict';
// GitDeck branches (create / switch / merge / rename / delete), tags, remotes, and
// stashes (whole tree or selected files). Classic script: shares globals with app.js.

const staticRow = (inner, extra) => '<div class="row ref-row"' + (extra || '') + '>' + inner + '</div>';
const rowBtn = (cls, data, label, title, danger) => '<button class="btn btn-sm' + (danger ? ' btn-danger' : '') + ' ' + cls + '"' +
  Object.entries(data).map(([k, v]) => ' data-' + k + '="' + esc(v) + '"').join('') + (title ? ' title="' + esc(title) + '"' : '') + '>' + label + '</button>';
const onAll = (sel, fn) => document.querySelectorAll(sel).forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); fn(b.dataset, b); }; });

// ---------- branches, tags, remotes ----------
function renderBranches() {
  const b = state.branchesData || { local: [], remote: [] };
  let html = '<div class="branches-create">' +
    '<input id="new-branch" placeholder="new-branch-name" spellcheck="false">' +
    '<button class="btn" id="act-create-branch">Create</button></div>';

  html += sectionHeader('Local (' + b.local.length + ')', '');
  for (const br of b.local) {
    const cur = br.isCurrent ? ' <span class="ref-badge head">HEAD</span>' : '';
    const upstream = br.upstream ? ' <span class="muted">&#8594; ' + esc(br.upstream) + '</span>' : '';
    html += staticRow('<span class="path">' + esc(br.name) + cur + upstream + '</span><span class="row-actions visible">' +
      rowBtn('act-rename', { name: br.name }, 'Rename') +
      (br.isCurrent ? '' : rowBtn('act-switch', { name: br.name }, 'Switch') + rowBtn('act-merge', { name: br.name }, 'Merge') +
        rowBtn('act-delete', { name: br.name }, 'Delete', '', true)) + '</span>');
  }

  html += sectionHeader('Remote-tracking (' + b.remote.length + ')', '');
  if (!b.remote.length) html += emptyRow('No remote branches');
  for (const br of b.remote) html += staticRow('<span class="path">' + esc(br.name) + '</span>');

  html += sectionHeader('Tags (' + state.tags.length + ')', '<button class="btn btn-sm" id="act-new-tag" title="Tag the current commit">New tag on HEAD</button>');
  if (!state.tags.length) html += emptyRow('No tags');
  const hasRemote = state.remotesData.length > 0;
  for (const t of state.tags) {
    html += staticRow('<span class="path"><span class="ref-badge tag">' + esc(t.name) + '</span>' +
      '<span class="blame-hash">' + esc(t.commit.slice(0, 8)) + '</span> <span class="muted">' + esc(t.subject || '') + '</span></span>' +
      '<span class="row-actions visible">' +
      (hasRemote ? rowBtn('act-push-tag', { name: t.name }, 'Push', 'Push this tag to a remote') +
        rowBtn('act-del-remote-tag', { name: t.name }, 'Delete remote', 'Delete this tag on a remote', true) : '') +
      rowBtn('act-del-tag', { name: t.name }, 'Delete', 'Delete the local tag', true) + '</span>');
  }

  html += sectionHeader('Remotes (' + state.remotesData.length + ')', '<button class="btn btn-sm" id="act-add-remote">Add remote</button>');
  if (!hasRemote) html += emptyRow('No remotes configured');
  for (const r of state.remotesData) {
    html += staticRow('<span class="path"><div>' + esc(r.name) + '</div><div class="remote-url">' + esc(r.fetch || '') + '</div></span>' +
      '<span class="row-actions visible">' + rowBtn('act-rm-remote', { name: r.name }, 'Remove', '', true) + '</span>', ' data-tall="1"');
  }

  $('#list-pane').innerHTML = html;
  wireBranches();
}

// Remote to use for a tag push: ask only when there is more than one.
async function pickRemote(title) {
  const names = state.remotesData.map((r) => r.name);
  if (names.length === 1) return names[0];
  const v = await formDialog({ title, ok: 'Continue', fields: [
    { name: 'remote', label: 'Remote', type: 'select', value: names.includes('origin') ? 'origin' : names[0],
      options: names.map((n) => ({ value: n, label: n })) }] });
  return v ? v.remote : null;
}

function wireBranches() {
  $('#act-create-branch').onclick = async () => {
    const name = $('#new-branch').value.trim();
    if (!name) { toast('Type a branch name first', 'error'); return; }
    try {
      await api('gd:createBranch', { repo: state.repo, name });
      await api('gd:switchBranch', { repo: state.repo, name });
      toast('Created and switched to ' + name, 'success');
      await refreshAll();
    } catch (e) { toast(e.message, 'error'); }
  };
  onAll('.act-switch', (d) => act('gd:switchBranch', 'Switched to ' + d.name, { name: d.name }));
  onAll('.act-merge', async (d) => {
    await act('gd:merge', 'Merged ' + d.name, { name: d.name });
    if (state.op === 'merge') setView('worktree'); // stopped on conflicts: show them
  });
  onAll('.act-delete', async (d) => {
    if (!(await confirmDialog('Delete branch ' + d.name + '?', { ok: 'Delete', danger: true }))) return;
    await act('gd:deleteBranch', 'Deleted ' + d.name, { name: d.name });
  });
  onAll('.act-rename', async (d) => {
    const v = await formDialog({ title: 'Rename branch ' + d.name, ok: 'Rename', fields: [{ name: 'newName', label: 'New name', value: d.name }] });
    if (!v || !v.newName.trim() || v.newName.trim() === d.name) return;
    await act('gd:renameBranch', 'Renamed to ' + v.newName.trim(), { name: d.name, newName: v.newName.trim() });
  });

  $('#act-new-tag').onclick = () => (state.log.length ? createTagDialog(null) : toast('No commits to tag yet', 'error'));
  onAll('.act-del-tag', async (d) => {
    if (!(await confirmDialog('Delete the local tag ' + d.name + '?', { ok: 'Delete', danger: true }))) return;
    await act('gd:deleteTag', 'Deleted tag ' + d.name, { name: d.name });
  });
  onAll('.act-push-tag', async (d) => {
    const remote = await pickRemote('Push tag ' + d.name);
    if (!remote) return;
    toast('Pushing ' + d.name + '…', '', true);
    await act('gd:pushTag', 'Pushed ' + d.name + ' to ' + remote, { remote, name: d.name });
  });
  onAll('.act-del-remote-tag', async (d) => {
    const remote = await pickRemote('Delete tag ' + d.name + ' on a remote');
    if (!remote || !(await confirmDialog('Delete tag ' + d.name + ' on ' + remote + '? Others may already use it.',
      { ok: 'Delete', danger: true }))) return;
    toast('Deleting ' + d.name + ' on ' + remote + '…', '', true);
    await act('gd:deleteRemoteTag', 'Deleted ' + d.name + ' on ' + remote, { remote, name: d.name });
  });

  $('#act-add-remote').onclick = async () => {
    const v = await formDialog({ title: 'Add remote', ok: 'Add', fields: [
      { name: 'name', label: 'Name', value: state.remotesData.length ? '' : 'origin' },
      { name: 'url', label: 'URL', placeholder: 'https://github.com/owner/repo.git' }] });
    if (!v || !v.name.trim() || !v.url.trim()) return;
    await act('gd:addRemote', 'Added remote ' + v.name.trim(), { name: v.name.trim(), url: v.url.trim() });
  };
  onAll('.act-rm-remote', async (d) => {
    if (!(await confirmDialog('Remove remote ' + d.name + '? Its remote-tracking branches are deleted too.',
      { ok: 'Remove', danger: true }))) return;
    await act('gd:removeRemote', 'Removed remote ' + d.name, { name: d.name });
  });
}

// ---------- stashes ----------
function dirtyPaths() {
  const st = state.status;
  return [...new Set([...st.staged, ...st.unstaged, ...st.untracked].map((e) => e.path))];
}

function renderStashes() {
  const files = dirtyPaths();
  let html = '<div class="branches-create stash-create">' +
    '<input id="stash-msg" placeholder="Stash message (optional)" spellcheck="true">' +
    '<label class="check"><input type="checkbox" id="stash-untracked"> Include untracked</label>' +
    '<button class="btn" id="act-stash"' + (files.length ? '' : ' disabled') + '>Stash changes</button></div>';
  if (files.length) {
    html += '<details class="stash-files"><summary>Files to stash (<span id="stash-sel">' + files.length + '</span> of ' + files.length + ')</summary>' +
      files.map((p) => '<label class="check stash-file"><input type="checkbox" class="stash-pick" value="' + esc(p) + '" checked> ' + esc(p) + '</label>').join('') +
      '</details>';
  }
  html += sectionHeader('Stashes (' + state.stashes.length + ')', '');
  if (!state.stashes.length) html += emptyRow('No stashes');
  for (const s of state.stashes) {
    const sel = state.selectedKey === 'stash:' + s.ref ? ' selected' : '';
    html += '<div class="row stash-row' + sel + '" data-ref="' + esc(s.ref) + '">' +
      '<span class="ref-badge local">' + esc(s.ref) + '</span>' +
      '<span class="path">' + esc(s.subject) + '</span>' +
      '<span class="date">' + esc(fmtDate(s.timestamp)) + '</span></div>';
  }
  $('#list-pane').innerHTML = html;

  const picks = () => [...document.querySelectorAll('.stash-pick')];
  picks().forEach((c) => {
    c.onchange = () => {
      const n = picks().filter((x) => x.checked).length;
      $('#stash-sel').textContent = String(n);
      $('#act-stash').disabled = n === 0;
    };
  });
  $('#act-stash').onclick = async () => {
    const chosen = picks().filter((x) => x.checked).map((x) => x.value);
    const untracked = new Set(state.status.untracked.map((e) => e.path));
    const includeUntracked = $('#stash-untracked').checked || (chosen.length < files.length && chosen.some((p) => untracked.has(p)));
    await act('gd:stashSave', chosen.length < files.length ? 'Stashed ' + chosen.length + ' file(s)' : 'Stashed changes', {
      message: $('#stash-msg').value,
      includeUntracked,
      paths: chosen.length < files.length ? chosen : [],
    });
  };
  document.querySelectorAll('#list-pane .stash-row').forEach((row) => {
    row.onclick = () => {
      state.selectedKey = 'stash:' + row.dataset.ref;
      document.querySelectorAll('#list-pane .stash-row').forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      showStash(row.dataset.ref);
    };
  });
}

async function showStash(ref) {
  try {
    const diffText = await api('gd:stashDiff', { repo: state.repo, ref });
    showDiff('<div class="detail-header"><span class="title">' + esc(ref) + '</span>' +
      '<button class="btn btn-sm" id="act-stash-apply" title="Apply and keep the stash">Apply</button>' +
      '<button class="btn btn-sm" id="act-stash-pop" title="Apply and remove the stash">Pop</button>' +
      '<button class="btn btn-sm btn-danger" id="act-stash-drop">Drop</button>' + MODE_SLOT + '</div>', diffText, null, () => {
      $('#act-stash-apply').onclick = () => stashAction(ref, 'gd:stashApply', 'Applied ' + ref);
      $('#act-stash-pop').onclick = () => stashAction(ref, 'gd:stashPop', 'Popped ' + ref);
      $('#act-stash-drop').onclick = async () => {
        if (await confirmDialog('Drop ' + ref + '? This cannot be undone.', { ok: 'Drop', danger: true })) {
          stashAction(ref, 'gd:stashDrop', 'Dropped ' + ref);
        }
      };
    });
  } catch (e) { toast(e.message, 'error'); }
}

// Pop and drop renumber the remaining stashes, so the shown one is gone or stale.
async function stashAction(ref, channel, msg) {
  await act(channel, msg, { ref });
  if (channel !== 'gd:stashApply') {
    state.selectedKey = null;
    state.redrawDetail = null;
    detail('');
    renderView();
  }
}
