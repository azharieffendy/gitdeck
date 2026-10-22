'use strict';
// GitDeck busy indicator: one tracker for every in-flight gd:* call. app.js's
// api() feeds it, and while an operation runs longer than a short delay it
// shows a centered, non-blocking card plus a thin bar along the top of the
// window (styles.css, body.busy). Quick calls end inside the delay and nothing
// ever appears, so the UI never flickers; once shown, the card stays for a
// minimum display time so a borderline operation cannot flash it. The tracker
// and the label tables are plain logic with no DOM, which keeps them
// unit-testable under Node like clone.js.

// What the busy card says for each channel; anything unmapped falls back to the
// channel name without its gd: prefix.
const OP_TITLES = {
  'gd:refresh': 'Refreshing repository', 'gd:openPath': 'Opening repository', 'gd:clone': 'Cloning repository',
  'gd:status': 'Reading status', 'gd:log': 'Reading history', 'gd:reflog': 'Reading reflog',
  'gd:commit': 'Committing', 'gd:commitPaths': 'Committing',
  'gd:stagePaths': 'Staging files', 'gd:stageAll': 'Staging files',
  'gd:unstagePaths': 'Unstaging files', 'gd:unstageAll': 'Unstaging files',
  'gd:applyPatch': 'Applying patch', 'gd:discard': 'Discarding changes',
  'gd:diffWorking': 'Reading changes', 'gd:diffStaged': 'Reading changes', 'gd:blame': 'Reading blame',
  'gd:fetch': 'Fetching', 'gd:pull': 'Pulling', 'gd:push': 'Pushing',
  'gd:merge': 'Merging', 'gd:cherryPick': 'Cherry-picking', 'gd:revert': 'Reverting',
  'gd:rebase': 'Rebasing', 'gd:rebaseCommits': 'Rebasing',
  'gd:switchBranch': 'Switching branch', 'gd:createBranch': 'Creating branch',
  'gd:renameBranch': 'Renaming branch', 'gd:deleteBranch': 'Deleting branch',
  'gd:createTag': 'Creating tag', 'gd:deleteTag': 'Deleting tag', 'gd:pushTag': 'Pushing tag',
  'gd:deleteRemoteTag': 'Deleting remote tag', 'gd:addRemote': 'Adding remote', 'gd:removeRemote': 'Removing remote',
  'gd:stashSave': 'Stashing changes', 'gd:stashApply': 'Applying stash', 'gd:stashPop': 'Applying stash',
  'gd:stashDrop': 'Dropping stash', 'gd:stashDiff': 'Reading stash', 'gd:stashList': 'Reading stashes',
  'gd:listFiles': 'Reading files', 'gd:readFile': 'Reading file', 'gd:readFileAt': 'Reading file',
  'gd:writeFile': 'Saving file', 'gd:fileLog': 'Reading file history',
  'gd:moveFile': 'Moving files', 'gd:removeFiles': 'Removing files', 'gd:trashFiles': 'Deleting files',
  'gd:ignorePaths': 'Ignoring files', 'gd:setFileFlag': 'Setting file flags',
  'gd:commitInfo': 'Reading commit', 'gd:lastMessage': 'Reading message', 'gd:commitTemplate': 'Reading template',
  'gd:resolveConflict': 'Resolving conflict', 'gd:conflictDiff': 'Reading conflict',
  'gd:conflictWithBase': 'Reading conflict', 'gd:saveResolved': 'Saving resolution',
  'gd:abortOp': 'Aborting operation', 'gd:continueOp': 'Continuing operation',
  'gd:submoduleUpdate': 'Updating submodules', 'gd:worktreeAdd': 'Adding worktree', 'gd:worktreeRemove': 'Removing worktree',
  'gd:lfsPull': 'Pulling LFS files', 'gd:lfsInfo': 'Reading LFS info',
  'gd:ghPulls': 'Loading pull requests', 'gd:ghPull': 'Loading pull request',
  'gd:ghCreatePull': 'Creating pull request', 'gd:ghCheckout': 'Checking out pull request', 'gd:ghInfo': 'Loading GitHub info',
  'gd:setGitPath': 'Checking git executable',
  'gd:branches': 'Reading branches', 'gd:tags': 'Reading tags', 'gd:remotes': 'Reading remotes',
  'gd:submodules': 'Reading submodules', 'gd:worktrees': 'Reading worktrees',
};
// Channels whose payload names what is running: the card then says which
// branch, tag, submodule or pull request, as the old status messages did.
const OP_DETAILS = {
  'gd:pull': (p) => p.rebase ? 'Pulling (rebase)' : 'Pulling',
  'gd:pushTag': (p) => 'Pushing tag ' + p.name + ' to ' + p.remote,
  'gd:deleteRemoteTag': (p) => 'Deleting tag ' + p.name + ' on ' + p.remote,
  'gd:submoduleUpdate': (p) => p.path ? 'Updating submodule ' + p.path : 'Updating submodules',
  'gd:ghCheckout': (p) => 'Checking out pull request #' + p.number,
  'gd:switchBranch': (p) => 'Switching to ' + p.name,
  'gd:merge': (p) => 'Merging ' + p.name,
};
// Channels that must never show the busy card: the credential reply is instant,
// and the pickers / external links wait for the user, not for git.
const OP_SILENT = /^gd:(askpassReply|openDialog|pickFolder|openExternal|revealFile|gitVersion)$/;
function busyLabel(channel, payload) {
  if (OP_SILENT.test(channel)) return null;
  if (OP_DETAILS[channel] && payload) return OP_DETAILS[channel](payload);
  return OP_TITLES[channel] || channel.replace(/^gd:/, '').replace(/^[a-z]/, (c) => c.toUpperCase());
}

// onChange({visible, label, count}) fires only when what is shown changes:
// an operation outlives the delay -> visible: true with the latest label;
// further operations begin or end while visible -> label/count update;
// the last operation ends -> visible: false, held until the minimum display
// time has passed (a later operation beginning cancels the hold). The label
// shown is always the most recently begun operation ("Fetching", ...).
function createBusyTracker(onChange, opts = {}) {
  const delay = opts.delay == null ? 300 : opts.delay;
  const minDisplay = opts.minDisplay == null ? 400 : opts.minDisplay;
  const ops = new Map(); // id -> label; Map order gives the latest begun
  let seq = 0;
  let visible = false;
  let timer = null; // shows the card once the delay has passed
  let hideTimer = null; // hides it once the minimum display time has passed
  let shownAt = 0;
  const latest = () => {
    let label = '';
    for (const l of ops.values()) label = l;
    return label;
  };
  const hide = () => {
    visible = false;
    onChange({ visible: false, label: '', count: 0 });
  };
  return {
    begin(label) {
      const id = ++seq;
      ops.set(id, label || 'Working');
      if (visible) {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } // resumed: hold is off
        onChange({ visible, label: latest(), count: ops.size });
      } else if (ops.size === 1) timer = setTimeout(() => {
        timer = null;
        visible = true;
        shownAt = Date.now();
        onChange({ visible, label: latest(), count: ops.size });
      }, delay);
      // More operations while still inside the delay: nothing yet; the timer
      // will fire with whatever is running at that moment.
      return id;
    },
    end(id) {
      if (!ops.delete(id)) return; // unknown ids (double end) are ignored
      if (ops.size === 0) {
        if (timer) { clearTimeout(timer); timer = null; } // ended within the delay: was never shown
        else if (visible && !hideTimer) {
          const hold = minDisplay - (Date.now() - shownAt);
          if (hold > 0) hideTimer = setTimeout(() => { hideTimer = null; hide(); }, hold);
          else hide();
        }
      } else if (visible) onChange({ visible, label: latest(), count: ops.size });
    },
    get count() { return ops.size; },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createBusyTracker, busyLabel, OP_TITLES };
else {
  // The card is decorative feedback: clicks pass straight through it.
  window.Busy = createBusyTracker((s) => {
    document.body.classList.toggle('busy', s.visible);
    const label = document.getElementById('busy-label');
    if (label) label.textContent = s.count > 1 ? s.label + ' (+' + (s.count - 1) + ' more)' : s.label;
  });
}
