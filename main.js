'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const g = require('./git.js');
const { registerIpc } = require('./ipc.js');
const { startAskpassServer } = require('./askpass/server.js');

const isWSL = !!(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);

function readProc(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
}

// Chromium on Linux sandboxes via unprivileged user namespaces, or else a
// setuid-root chrome-sandbox helper. An npm-installed Electron never has the
// setuid helper, and Ubuntu 23.10+ (AppArmor) / some Debian kernels block
// unprivileged namespaces, so Electron aborts at startup. Detect that case.
function linuxSandboxUnavailable() {
  if (process.platform !== 'linux') return false;
  const restricted = readProc('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1' ||
    readProc('/proc/sys/kernel/unprivileged_userns_clone') === '0';
  if (!restricted) return false;
  try {
    const st = fs.statSync(path.join(path.dirname(process.execPath), 'chrome-sandbox'));
    return !(st.uid === 0 && (st.mode & 0o4000));
  } catch { return true; }
}

if (!isWSL && (process.env.GITDECK_NO_SANDBOX === '1' || linuxSandboxUnavailable())) {
  console.warn('GitDeck: Chromium sandbox unavailable; running with --no-sandbox. ' +
    'See README "Running on Linux" to enable it.');
  app.commandLine.appendSwitch('no-sandbox');
}

// WSL: Chromium sandbox needs user namespaces that WSL may not expose.
if (isWSL) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('no-zygote');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  if (process.argv.some((a) => a.indexOf('--shot=') === 0)) {
    app.commandLine.appendSwitch('disable-gpu');
  }
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 600,
    backgroundColor: '#16181c', // Graphite --bg (dark)
    title: 'GitDeck',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.removeMenu();
  // The UI is a single local page: never open new windows or navigate away.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('context-menu', (_e, params) => showContextMenu(params));
  // A reloaded or crashed page can no longer answer: cancel what it was asked.
  win.webContents.on('did-start-loading', cancelPrompts);
  win.webContents.on('render-process-gone', cancelPrompts);
  win.on('closed', () => { cancelPrompts(); win = null; });
  const pathArg = process.argv.find((a) => a.indexOf('--path=') === 0);
  const viewArg = process.argv.find((a) => a.indexOf('--view=') === 0);
  const params = new URLSearchParams();
  if (pathArg) params.set('repo', pathArg.slice(7));
  if (viewArg) params.set('view', viewArg.slice(7));
  const search = params.toString();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), search ? { search } : undefined);
}

// Spell-check suggestions and clipboard actions for text fields (commit message).
function showContextMenu(params) {
  if (!params.isEditable) return;
  const items = params.dictionarySuggestions.slice(0, 6).map((word) => ({
    label: word, click: () => win.webContents.replaceMisspelling(word),
  }));
  if (params.misspelledWord) {
    if (!items.length) items.push({ label: 'No suggestions', enabled: false });
    items.push({
      label: 'Add to dictionary',
      click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    items.push({ type: 'separator' });
  }
  items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
  Menu.buildFromTemplate(items).popup({ window: win });
}

// ---- credential prompts ------------------------------------------------------
// git/ssh -> askpass helper -> askpass server -> renderer dialog -> answer back.
const pendingPrompts = new Map();
let nextPromptId = 1;

function askUser(req) {
  if (!win || win.isDestroyed()) return Promise.resolve(null);
  const id = nextPromptId++;
  return new Promise((resolve) => {
    pendingPrompts.set(id, resolve);
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send('gd:askpass', { id, prompt: req.prompt, kind: req.kind, target: req.target });
  });
}

function cancelPrompts() {
  for (const resolve of pendingPrompts.values()) resolve(null);
  pendingPrompts.clear();
}

const handle = (channel, fn) => ipcMain.handle(channel, async (_e, payload) => {
  try { return { ok: true, data: await fn(payload || {}) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

app.whenReady().then(async () => {
  try {
    const askpass = await startAskpassServer(askUser);
    g.configureAskpass(askpass.env);
    app.on('will-quit', askpass.close);
  } catch (e) {
    console.warn('GitDeck: credential prompts unavailable: ' + e.message);
  }

  handle('gd:askpassReply', (p) => {
    const resolve = pendingPrompts.get(p.id);
    if (resolve) { pendingPrompts.delete(p.id); resolve(typeof p.answer === 'string' ? p.answer : null); }
  });
  registerIpc({ handle, dialog, shell, getWin: () => win });

  createWindow();

  const shotArg = process.argv.find((a) => a.indexOf('--shot=') === 0);
  if (shotArg) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          await win.webContents.executeJavaScript('void 0');
          const img = await win.webContents.capturePage();
          fs.writeFileSync(shotArg.slice(7), img.toPNG());
          console.log('SHOT_OK ' + shotArg.slice(7) + ' bytes=' + img.toPNG().length);
        } catch (e) { console.log('SHOT_FAILED ' + e.message); }
        app.exit(0);
      }, 3000);
    });
  }

  if (process.argv.includes('--smoke')) {
    const consoleErrors = [];
    // Electron 35+ passes {level:'error'|..., message} on the event; older versions pass them positionally.
    win.webContents.on('console-message', (e, legacyLevel, legacyMessage) => {
      const level = e && e.level !== undefined ? e.level : legacyLevel;
      const message = String(e && e.message !== undefined ? e.message : legacyMessage);
      if (level === 'error' || level === 'warning' || level >= 2 || /error/i.test(message)) {
        consoleErrors.push(message.slice(0, 300));
      }
    });
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const title = win.webContents.getTitle();
        let dom = '';
        try {
          dom = await win.webContents.executeJavaScript(
            "document.querySelectorAll('#list-pane .row').length + ' rows, ' + " +
            "document.querySelectorAll('#files-tree .ft-row').length + ' ft-rows, ' + " +
            "document.querySelectorAll('.busy-card').length + ' busy-card, ' + " +
            "document.querySelectorAll('.hrow').length + ' commits, ' + " +
            "document.querySelectorAll('.commit-graph circle').length + ' nodes, ' + " +
            "document.querySelectorAll('.commit-graph path').length + ' edges, repo=' + " +
            "document.getElementById('repo-name').textContent");
        } catch (e) { dom = 'dom-probe-failed: ' + e.message; }
        console.log('SMOKE title=' + title + ' errors=' + consoleErrors.length + ' dom=[' + dom + ']' +
          (consoleErrors.length ? ' | ' + consoleErrors.join(' ; ') : ''));
        app.exit(consoleErrors.length || title.indexOf('GitDeck') === -1 ? 1 : 0);
      }, 1500);
    });
  }
});

app.on('window-all-closed', () => app.quit());
