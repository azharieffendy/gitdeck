'use strict';
// GitDeck repository view: submodules, linked worktrees, and Git LFS.
// Classic script: shares globals with app.js (openRepo comes from tabs.js).

async function renderRepository() {
  const repo = state.repo;
  $('#list-pane').innerHTML = '<div class="diff-empty">Loading…</div>';
  const safe = (p) => p.catch((e) => ({ error: e.message }));
  const [subs, wts, lfs] = await Promise.all([
    safe(api('gd:submodules', { repo })), safe(api('gd:worktrees', { repo })), safe(api('gd:lfsInfo', { repo }))]);
  if (state.repo !== repo || state.view !== 'repository') return;

  let html = sectionHeader('Submodules' + (Array.isArray(subs) ? ' (' + subs.length + ')' : ''),
    Array.isArray(subs) && subs.length ? '<button class="btn btn-sm" id="act-sub-all" title="git submodule update --init --recursive">Update all</button>' : '');
  if (subs.error) html += emptyRow(subs.error);
  else if (!subs.length) html += emptyRow('No submodules');
  else {
    for (const s of subs) {
      html += '<div class="row ref-row"><span class="path">' + esc(s.path) + ' <span class="sub-state sub-' + esc(s.state) + '">' + esc(s.state) + '</span>' +
        '<div class="remote-url">' + esc(s.sha.slice(0, 10) + (s.describe ? ' (' + s.describe + ')' : '')) + '</div></span>' +
        '<span class="row-actions visible"><button class="btn btn-sm act-sub-update" data-path="' + esc(s.path) + '">Update</button>' +
        (s.state === 'uninitialized' ? '' : '<button class="btn btn-sm act-open-tab" data-dir="' + esc(s.abs) + '">Open</button>') + '</span></div>';
    }
  }

  html += sectionHeader('Worktrees' + (Array.isArray(wts) ? ' (' + wts.length + ')' : ''), '<button class="btn btn-sm" id="act-wt-add">Add worktree</button>');
  if (wts.error) html += emptyRow(wts.error);
  else {
    for (const w of wts) {
      const label = w.bare ? 'bare' : w.detached ? 'detached ' + (w.head || '').slice(0, 8) : (w.branch || '');
      html += '<div class="row ref-row"><span class="path">' + esc(w.path) + (w.isMain ? ' <span class="ref-badge head">main</span>' : '') +
        (w.locked ? ' <span class="muted">locked</span>' : '') + (w.prunable ? ' <span class="muted">missing</span>' : '') +
        '<div class="remote-url">' + esc(label) + '</div></span><span class="row-actions visible">' +
        (w.bare || w.prunable ? '' : '<button class="btn btn-sm act-open-tab" data-dir="' + esc(w.path) + '">Open</button>') +
        (w.isMain ? '' : '<button class="btn btn-sm btn-danger act-wt-rm" data-dir="' + esc(w.path) + '">Remove</button>') + '</span></div>';
    }
  }

  html += sectionHeader('Git LFS', lfs.installed ? '<button class="btn btn-sm" id="act-lfs-pull" title="Download LFS objects for the current checkout">Pull LFS files</button>' : '');
  if (lfs.error) html += emptyRow(lfs.error);
  else if (!lfs.installed) html += emptyRow('git-lfs is not installed');
  else {
    html += emptyRow(lfs.version);
    html += lfs.patterns.length ? lfs.patterns.map((p) => '<div class="row ref-row"><span class="path">' + esc(p.pattern) +
      ' <span class="muted">(' + esc(p.source) + ')</span></span></div>').join('') : emptyRow('No tracked patterns');
    const missing = lfs.files.filter((f) => !f.present).length;
    if (lfs.files.length) html += emptyRow(lfs.files.length + ' LFS file(s)' + (missing ? ', ' + missing + ' not downloaded (pointer only)' : ''));
  }

  $('#list-pane').innerHTML = html;
  wireRepository();
}

function wireRepository() {
  const busy = async (msg, ok, channel, extra) => {
    toast(msg, '', true);
    await act(channel, ok, extra);
    renderRepository();
  };
  const all = $('#act-sub-all');
  if (all) all.onclick = () => busy('Updating submodules…', 'Submodules updated', 'gd:submoduleUpdate', {});
  document.querySelectorAll('.act-sub-update').forEach((b) => {
    b.onclick = () => busy('Updating ' + b.dataset.path + '…', 'Updated ' + b.dataset.path, 'gd:submoduleUpdate', { path: b.dataset.path });
  });
  document.querySelectorAll('.act-open-tab').forEach((b) => { b.onclick = () => openRepo(b.dataset.dir); });
  document.querySelectorAll('.act-wt-rm').forEach((b) => {
    b.onclick = async () => {
      if (!window.confirm('Remove the worktree at ' + b.dataset.dir + '? Its folder is deleted.')) return;
      try { await api('gd:worktreeRemove', { repo: state.repo, dir: b.dataset.dir, force: false }); }
      catch (e) {
        if (!window.confirm(e.message + '\n\nIt has changes. Remove it anyway and lose them?')) return;
        try { await api('gd:worktreeRemove', { repo: state.repo, dir: b.dataset.dir, force: true }); }
        catch (e2) { toast(e2.message, 'error'); return; }
      }
      closeTab(b.dataset.dir);
      toast('Removed worktree', 'success');
      renderRepository();
    };
  });
  $('#act-wt-add').onclick = addWorktree;
  const lfsPull = $('#act-lfs-pull');
  if (lfsPull) lfsPull.onclick = () => busy('Pulling LFS files…', 'LFS files downloaded', 'gd:lfsPull', {});
}

async function addWorktree() {
  const dir = await api('gd:pickFolder', { title: 'Folder for the new worktree (empty or new)' }).catch((e) => { toast(e.message, 'error'); return null; });
  if (!dir) return;
  const used = new Set();
  try { (await api('gd:worktrees', { repo: state.repo })).forEach((w) => w.branch && used.add(w.branch)); } catch { /* best effort */ }
  const free = ((state.branchesData && state.branchesData.local) || []).map((b) => b.name).filter((n) => !used.has(n));
  const v = await formDialog({ title: 'Add worktree', ok: 'Add', note: dir, fields: [
    { name: 'newBranch', label: 'New branch (leave empty to check out an existing one)', placeholder: 'feature/name' },
    { name: 'branch', label: 'Existing branch', type: 'select', value: free[0] || '',
      options: [{ value: '', label: '(detached at HEAD)' }].concat(free.map((n) => ({ value: n, label: n }))) },
    { name: 'open', label: 'Open it in a new tab', type: 'checkbox', value: true }] });
  if (!v) return;
  const newBranch = v.newBranch.trim();
  try {
    await api('gd:worktreeAdd', { repo: state.repo, dir, newBranch: newBranch || undefined, branch: newBranch ? undefined : (v.branch || undefined) });
    toast('Added worktree at ' + dir, 'success');
    await refreshAll();
    if (v.open) openRepo(dir);
  } catch (e) { toast(e.message, 'error'); }
}
