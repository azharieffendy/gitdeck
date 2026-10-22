'use strict';
// GitDeck clone, modeled on SmartGit's Clone dialog: repository URL, parent
// directory and directory name (pre-filled from the URL), with the resulting
// path shown live. Classic script: shares globals with app.js (openRepo comes
// from tabs.js).

// The directory name git clone itself would derive: last URL segment, minus .git.
// Splits on /, \ and : so scp-style URLs (git@host:repo.git) yield the repo name too.
function repoNameFromUrl(url) {
  const seg = String(url || '').trim().replace(/[\\/]+$/, '').split(/[\\/:]/).pop() || '';
  return seg.replace(/\.git$/i, '').replace(/[<>:"|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim();
}

// Live "clone into" preview inside the form dialog (onOpen hook from formDialog):
// the directory name follows the URL until the user edits it by hand.
function wireClonePreview(dlg) {
  const form = dlg.querySelector('form');
  const preview = document.createElement('div');
  preview.className = 'fd-note';
  preview.id = 'clone-preview';
  form.insertBefore(preview, form.querySelector('.cred-actions'));
  const url = dlg.querySelector('#fd-url');
  const parent = dlg.querySelector('#fd-parent');
  const name = dlg.querySelector('#fd-name');
  let nameEdited = false;
  name.addEventListener('input', () => { nameEdited = true; });
  const update = () => {
    const derived = repoNameFromUrl(url.value);
    if (!nameEdited && derived) name.value = derived;
    const n = name.value.trim() || derived;
    if (!parent.value || !n) {
      preview.textContent = 'The repository is cloned into a new subdirectory of the parent directory.';
      return;
    }
    const sep = /^[a-zA-Z]:/.test(parent.value) || (parent.value.includes('\\') && !parent.value.includes('/')) ? '\\' : '/';
    preview.textContent = 'Clone into ' + parent.value.replace(/[\\/]+$/, '') + sep + n;
  };
  url.addEventListener('input', update);
  name.addEventListener('input', update);
  parent.addEventListener('change', update);
  update();
}

// One clone at a time: the Clone buttons are disabled while git runs.
let cloning = false;

async function cloneDialog() {
  if (cloning) return;
  const v = await formDialog({ title: 'Clone repository', ok: 'Clone', fields: [
    { name: 'url', label: 'Repository URL', placeholder: 'https://github.com/user/repo.git' },
    { name: 'parent', label: 'Parent directory', type: 'folder', pickTitle: 'Parent directory for the new clone' },
    { name: 'name', label: 'Directory name', placeholder: 'repo' },
  ], onOpen: wireClonePreview });
  if (!v) return;
  const url = (v.url || '').trim();
  const name = (v.name || '').trim() || repoNameFromUrl(url);
  if (!url) { toast('Enter the repository URL to clone from', 'error'); return; }
  if (!name) { toast('Cannot derive a directory name from that URL; type one', 'error'); return; }
  if (!v.parent) { toast('Choose the parent directory to clone into', 'error'); return; }
  cloning = true;
  const buttons = document.querySelectorAll('#btn-clone, #btn-clone-2');
  buttons.forEach((b) => { b.disabled = true; });
  // The busy card (busy.js) shows "Cloning repository" for the whole clone.
  try {
    const repo = await api('gd:clone', { url, parent: v.parent, name });
    toast('Cloned into ' + repo, 'success');
    await openRepo(repo);
  } catch (e) { toast(e.message, 'error'); }
  finally {
    cloning = false;
    buttons.forEach((b) => { b.disabled = false; });
  }
}

// Under Node (renderer unit tests) export the pure helper; in the app, wire the buttons.
if (typeof module !== 'undefined' && module.exports) module.exports = { repoNameFromUrl };
else document.querySelectorAll('#btn-clone, #btn-clone-2').forEach((b) => { b.onclick = cloneDialog; });
