'use strict';
// GitDeck IPC channels: every gd:* call the renderer can make. Each handler gets the
// renderer's payload; results and errors are wrapped by main.js's handle().
const fs = require('fs');
const path = require('path');
const g = require('./git.js');
const more = require('./git-more.js');
const gh = require('./github.js');

// deps: {handle, dialog, shell, getWin}
function registerIpc({ handle, dialog, shell, getWin }) {
  const pickFolder = async (title) => {
    const res = await dialog.showOpenDialog(getWin(), { title, properties: ['openDirectory', 'createDirectory'] });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  };

  // ---- repositories & settings
  handle('gd:openDialog', async () => {
    const dir = await pickFolder('Open repository');
    return dir ? g.toplevel(dir) : null;
  });
  handle('gd:openPath', (p) => g.toplevel(p.path));
  handle('gd:pickFolder', (p) => pickFolder(p.title || 'Choose folder'));
  // The renderer sends parent + directory name (SmartGit-style); main joins them.
  handle('gd:clone', async (p) => {
    if (typeof p.parent !== 'string' || !p.parent.trim()) throw new Error('Choose a parent directory first');
    const name = String(p.name || '').trim();
    // The same class repoNameFromUrl strips: Windows-invalid characters and controls.
    if (!name || name === '.' || name === '..' || /[\\/:<>:"|?*\x00-\x1f]/.test(name)) {
      throw new Error('Invalid directory name: ' + name);
    }
    return g.clone(p.url, path.join(p.parent, name));
  });
  handle('gd:setGitPath', async (p) => {
    const exe = (p.path || '').trim();
    if (exe && !fs.existsSync(exe)) throw new Error('No such file: ' + exe);
    g.configureGit(exe);
    try { return (await g.run(process.cwd(), ['--version'])).trim(); }
    catch (e) { g.configureGit(''); throw new Error('Not a working git (' + e.message + '); using git from PATH'); }
  });
  handle('gd:gitVersion', async () => (await g.run(process.cwd(), ['--version'])).trim());
  handle('gd:openExternal', async (p) => {
    // Pull request pages and links in their Markdown: web links only, never file: or custom schemes.
    let url;
    try { url = new URL(String(p.url)); } catch { throw new Error('Not a valid link'); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only web links can be opened');
    await shell.openExternal(url.href);
  });

  // ---- working tree
  handle('gd:status', (p) => g.status(p.repo));
  handle('gd:stagePaths', (p) => g.stage(p.repo, p.paths));
  handle('gd:stageAll', (p) => g.stageAll(p.repo));
  handle('gd:unstagePaths', (p) => g.unstage(p.repo, p.paths));
  handle('gd:unstageAll', (p) => g.unstageAll(p.repo));
  handle('gd:commit', async (p) => ({
    head: await g.commit(p.repo, p.message, { amend: !!p.amend }),
    status: await g.status(p.repo),
  }));
  handle('gd:lastMessage', (p) => g.lastCommitMessage(p.repo));
  handle('gd:commitTemplate', (p) => more.commitTemplate(p.repo));
  handle('gd:applyPatch', (p) => g.applyPatch(p.repo, p.patch, { cached: !!p.cached, reverse: !!p.reverse }));
  handle('gd:discard', (p) => g.discard(p.repo, p.paths || [], p.untracked || []));
  handle('gd:readFile', (p) => more.readWorkingFile(p.repo, p.path));
  handle('gd:writeFile', (p) => more.writeWorkingFile(p.repo, p.path, p.content));
  handle('gd:diffWorking', (p) => g.diffWorking(p.repo, p.path));
  handle('gd:diffStaged', (p) => g.diffStaged(p.repo, p.path));
  handle('gd:blame', (p) => g.blame(p.repo, p.path, p.rev || null));

  // ---- stash
  handle('gd:stashList', (p) => g.stashList(p.repo));
  handle('gd:stashSave', (p) => g.stashSave(p.repo, p.message, !!p.includeUntracked, p.paths || []));
  handle('gd:stashApply', (p) => g.stashApply(p.repo, p.ref));
  handle('gd:stashPop', (p) => g.stashPop(p.repo, p.ref));
  handle('gd:stashDrop', (p) => g.stashDrop(p.repo, p.ref));
  handle('gd:stashDiff', (p) => g.stashDiff(p.repo, p.ref));

  // ---- history & operations
  handle('gd:commitInfo', async (p) => ({
    meta: await g.commitMeta(p.repo, p.hash),
    diff: await g.commitDiff(p.repo, p.hash),
  }));
  handle('gd:log', (p) => g.log(p.repo, 900));
  handle('gd:reflog', (p) => more.reflog(p.repo));
  handle('gd:cherryPick', (p) => (Array.isArray(p.hashes) ? more.cherryPickMany(p.repo, p.hashes) : g.cherryPick(p.repo, p.hash)));
  handle('gd:revert', (p) => g.revert(p.repo, p.hash));
  handle('gd:abortOp', (p) => more.abortOperation(p.repo, p.op));
  handle('gd:continueOp', (p) => more.continueOperation(p.repo, p.op));
  handle('gd:resolveConflict', (p) => g.resolveConflict(p.repo, p.path, p.side));
  handle('gd:conflictDiff', (p) => g.conflictDiff(p.repo, p.path));
  handle('gd:conflictWithBase', (p) => more.conflictWithBase(p.repo, p.path));
  handle('gd:saveResolved', (p) => more.saveResolved(p.repo, p.path, p.content));
  handle('gd:rebaseCommits', (p) => more.rebaseCommits(p.repo, p.base || null));
  handle('gd:rebase', (p) => more.rebaseInteractive(p.repo, p.base || null, p.steps));

  // ---- branches, tags, remotes
  handle('gd:branches', (p) => g.branches(p.repo));
  handle('gd:remotes', (p) => g.remotes(p.repo));
  handle('gd:createBranch', (p) => g.createBranch(p.repo, p.name, p.from));
  handle('gd:switchBranch', (p) => g.switchBranch(p.repo, p.name));
  handle('gd:renameBranch', (p) => more.renameBranch(p.repo, p.name, p.newName));
  handle('gd:merge', (p) => g.merge(p.repo, p.name));
  handle('gd:deleteBranch', (p) => g.deleteBranch(p.repo, p.name, !!p.force));
  handle('gd:tags', (p) => more.tags(p.repo));
  handle('gd:createTag', (p) => more.createTag(p.repo, p.name, p.target, p.message));
  handle('gd:deleteTag', (p) => more.deleteTag(p.repo, p.name));
  handle('gd:pushTag', (p) => more.pushTag(p.repo, p.remote, p.name));
  handle('gd:deleteRemoteTag', (p) => more.deleteRemoteTag(p.repo, p.remote, p.name));
  handle('gd:addRemote', (p) => more.addRemote(p.repo, p.name, p.url));
  handle('gd:removeRemote', (p) => more.removeRemote(p.repo, p.name));

  // ---- network
  handle('gd:fetch', (p) => g.fetch(p.repo));
  handle('gd:push', (p) => g.push(p.repo));
  handle('gd:pull', (p) => g.pull(p.repo, { rebase: !!p.rebase }));

  // ---- submodules, worktrees, LFS
  handle('gd:submodules', (p) => more.submodules(p.repo));
  handle('gd:submoduleUpdate', (p) => more.submoduleUpdate(p.repo, p.path || null));
  handle('gd:worktrees', (p) => more.worktrees(p.repo));
  handle('gd:worktreeAdd', (p) => more.worktreeAdd(p.repo, p.dir, { branch: p.branch, newBranch: p.newBranch }));
  handle('gd:worktreeRemove', (p) => more.worktreeRemove(p.repo, p.dir, !!p.force));
  handle('gd:lfsInfo', (p) => more.lfsInfo(p.repo));
  handle('gd:lfsPull', (p) => more.lfsPull(p.repo));

  // ---- GitHub
  handle('gd:ghInfo', (p) => gh.info(p.repo));
  handle('gd:ghPulls', (p) => gh.listPulls(p.repo, p.state));
  handle('gd:ghPull', (p) => gh.getPull(p.repo, p.number));
  handle('gd:ghCreatePull', (p) => gh.createPull(p.repo, p));
  handle('gd:ghCheckout', (p) => gh.checkoutPull(p.repo, p.number));

  handle('gd:refresh', async (p) => ({
    branch: await g.currentBranch(p.repo),
    status: await g.status(p.repo),
    log: await g.log(p.repo, 900),
    branches: await g.branches(p.repo),
    remotes: await g.remotes(p.repo),
    tags: await more.tags(p.repo).catch(() => []),
    ab: await g.aheadBehind(p.repo).catch(() => null),
    head: await g.headInfo(p.repo),
    stashes: await g.stashList(p.repo).catch(() => []),
    op: await g.operationInProgress(p.repo).catch(() => null),
  }));
}

module.exports = { registerIpc };
