'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const g = require('./git.js');

// WSL: Chromium sandbox needs user namespaces that WSL may not expose.
if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
  app.commandLine.appendSwitch('no-sandbox');
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
    backgroundColor: '#0d1117',
    title: 'GitDeck',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.removeMenu();
  const pathArg = process.argv.find((a) => a.indexOf('--path=') === 0);
  const viewArg = process.argv.find((a) => a.indexOf('--view=') === 0);
  const params = new URLSearchParams();
  if (pathArg) params.set('repo', pathArg.slice(7));
  if (viewArg) params.set('view', viewArg.slice(7));
  const search = params.toString();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), search ? { search } : undefined);
}

const handle = (channel, fn) => ipcMain.handle(channel, async (_e, payload) => {
  try { return { ok: true, data: await fn(payload || {}) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

app.whenReady().then(() => {
  handle('gd:openDialog', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    return g.toplevel(res.filePaths[0]);
  });
  handle('gd:openPath', async (p) => g.toplevel(p.path));
  handle('gd:status', (p) => g.status(p.repo));
  handle('gd:stagePaths', (p) => g.stage(p.repo, p.paths));
  handle('gd:stageAll', (p) => g.stageAll(p.repo));
  handle('gd:unstagePaths', (p) => g.unstage(p.repo, p.paths));
  handle('gd:unstageAll', (p) => g.unstageAll(p.repo));
  handle('gd:commit', async (p) => ({ head: await g.commit(p.repo, p.message), status: await g.status(p.repo) }));
  handle('gd:diffWorking', (p) => g.diffWorking(p.repo, p.path));
  handle('gd:diffStaged', (p) => g.diffStaged(p.repo, p.path));
  handle('gd:commitInfo', async (p) => ({
    meta: await g.commitMeta(p.repo, p.hash),
    diff: await g.commitDiff(p.repo, p.hash),
  }));
  handle('gd:log', (p) => g.log(p.repo, 900));
  handle('gd:branches', (p) => g.branches(p.repo));
  handle('gd:remotes', (p) => g.remotes(p.repo));
  handle('gd:createBranch', (p) => g.createBranch(p.repo, p.name, p.from));
  handle('gd:switchBranch', (p) => g.switchBranch(p.repo, p.name));
  handle('gd:merge', (p) => g.merge(p.repo, p.name));
  handle('gd:deleteBranch', (p) => g.deleteBranch(p.repo, p.name, !!p.force));
  handle('gd:push', (p) => g.push(p.repo));
  handle('gd:pull', (p) => g.pull(p.repo));
  handle('gd:refresh', async (p) => ({
    branch: await g.currentBranch(p.repo),
    status: await g.status(p.repo),
    log: await g.log(p.repo, 900),
    branches: await g.branches(p.repo),
    remotes: await g.remotes(p.repo),
    ab: await g.aheadBehind(p.repo).catch(() => null),
    head: await g.headInfo(p.repo),
  }));

  createWindow();

  const shotArg = process.argv.find((a) => a.indexOf('--shot=') === 0);
  if (shotArg) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          await win.webContents.executeJavaScript('void 0');
          const img = await win.webContents.capturePage();
          require('fs').writeFileSync(shotArg.slice(7), img.toPNG());
          console.log('SHOT_OK ' + shotArg.slice(7) + ' bytes=' + img.toPNG().length);
        } catch (e) { console.log('SHOT_FAILED ' + e.message); }
        app.exit(0);
      }, 3000);
    });
  }

  if (process.argv.includes('--smoke')) {
    const consoleErrors = [];
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2 || /error/i.test(message)) consoleErrors.push(String(message).slice(0, 300));
    });
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const title = win.webContents.getTitle();
        let dom = '';
        try {
          dom = await win.webContents.executeJavaScript(
            "document.querySelectorAll('#list-pane .row').length + ' rows, ' + " +
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
