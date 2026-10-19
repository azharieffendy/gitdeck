'use strict';
// GitDeck settings: theme (system / light / dark), Git executable, pull mode.
// Stored as renderer preferences; the Git path is pushed to the main process at
// startup and on save. Classic script: shares globals with app.js.

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const btn = $('#btn-theme');
  if (btn) btn.title = 'Theme: ' + (theme || 'system') + ' (click to switch)';
}

function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// Toolbar button: flip between light and dark (an explicit choice overrides "system").
function toggleTheme() {
  const next = effectiveTheme() === 'light' ? 'dark' : 'light';
  savePref('theme', next);
  applyTheme(next);
}

async function applyGitPath(p) {
  return api('gd:setGitPath', { path: p || '' });
}

async function openSettings() {
  let version = '';
  try { version = await api('gd:gitVersion', {}); } catch (e) { version = e.message; }
  const v = await formDialog({ title: 'Settings', ok: 'Save', note: 'Using ' + version, fields: [
    { name: 'theme', label: 'Theme', type: 'select', value: loadPref('theme', 'system'), options: [
      { value: 'system', label: 'Follow the system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] },
    { name: 'gitPath', label: 'Git executable (empty: use git from PATH)', value: loadPref('gitPath', ''),
      placeholder: navigator.platform.startsWith('Win') ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git' },
    { name: 'pullMode', label: 'Pull', type: 'select', value: loadPref('pullMode', 'merge'), options: [
      { value: 'merge', label: 'Merge the upstream changes (git pull)' }, { value: 'rebase', label: 'Rebase onto them (git pull --rebase)' }] }] });
  if (!v) return;
  savePref('theme', v.theme);
  applyTheme(v.theme);
  savePref('pullMode', v.pullMode);
  const gitPath = v.gitPath.trim();
  try {
    const ver = await applyGitPath(gitPath);
    savePref('gitPath', gitPath);
    toast('Settings saved · ' + ver, 'success');
  } catch (e) { toast('Git path not saved: ' + e.message, 'error'); }
}

function initSettings() {
  applyTheme(loadPref('theme', 'system'));
  const gitPath = loadPref('gitPath', '');
  if (gitPath) applyGitPath(gitPath).catch((e) => toast('Configured Git not usable (' + e.message + '); using git from PATH', 'error'));
  $('#btn-theme').onclick = toggleTheme;
  $('#btn-settings').onclick = openSettings;
}
