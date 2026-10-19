<div align="center">

# GitDeck

**An original, open-source desktop Git client built with Electron.**

[![License: MIT](https://img.shields.io/badge/License-MIT-3fb950.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-2026-58a6ff.svg)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-bc8cff.svg)](#requirements)

Browse the working tree. Stage, commit, and inspect diffs. Walk a real branch
graph. Manage branches. Push and pull. No accounts, no telemetry, no lock-in.

</div>

---

## Table of contents

1. [About](#about)
2. [Features](#features)
3. [Interface overview](#interface-overview)
4. [Requirements](#requirements)
5. [Getting started](#getting-started)
6. [Usage guide](#usage-guide)
7. [Command-line reference](#command-line-reference)
8. [Architecture](#architecture)
9. [The git layer](#the-git-layer)
10. [The history graph](#the-history-graph)
11. [The diff engine](#the-diff-engine)
12. [Design system](#design-system)
13. [Credential prompts](#credential-prompts)
14. [Security model](#security-model)
15. [Testing](#testing)
16. [Running on Windows](#running-on-windows)
17. [Running on Linux](#running-on-linux)
18. [Running under WSL](#running-under-wsl)
19. [Troubleshooting](#troubleshooting)
20. [Roadmap](#roadmap)
21. [Contributing](#contributing)
22. [License](#license)
23. [Acknowledgments](#acknowledgments)

---

## About

GitDeck is a lightweight Git client for people who want the everyday workflow
of a graphical client — stage, commit, diff, branch, sync — without the weight
of a full IDE plugin or a proprietary product. It wraps the standard `git`
CLI you already have installed, adds a fast three-pane interface, and stays
out of your way.

Every line of code in this repository is original and MIT-licensed. GitDeck
is not affiliated with, derived from, or endorsed by any other Git client.

## Features

### Working tree
- Live status for **staged**, **unstaged**, and **untracked** files, refreshed
  after every action
- Status badges: `M` modified, `A` added, `D` deleted, `R` renamed (with the
  original path shown), `C` copied, `?` untracked, `!` conflict
- **Per-file stage / unstage** buttons that appear on hover
- **Stage all** / **Unstage all** section actions
- Rename-aware: files staged as renames show `old -> new`
- Commit box with message validation, a live staged-file counter, spell
  checking (right-click a word for suggestions), and an **Amend last commit**
  option that loads the previous message
- **Discard** changes per file (asks first; untracked files are deleted)
- **Merge / cherry-pick / revert in progress** banner with **Continue** (enabled
  once no conflicts remain) and **Abort**
- **Conflict view**: see the conflicting hunks with their markers, take
  **ours** or **theirs** for the whole file, or edit it yourself and
  **Mark resolved**
- **Blame**: per-line commit, author, and date for any tracked file; click a
  hash to jump to that commit in History

### Stashes
- Stash the working tree with an optional message, optionally including
  untracked files
- Browse stashes with their diffs; **apply**, **pop**, or **drop** each one

### Diff viewer
- **Unified** or **side-by-side** layout, switchable per diff and remembered
- **Hunk actions**: stage, unstage, or discard a single hunk instead of the
  whole file
- Unified diffs with **old/new line numbers**, the change sign column, and
  color-coded rows (green additions, red deletions)
- Three diff sources: **working tree** (unstaged), **index** (staged), and
  **any commit** from history
- Per-file +/- statistics in each file header
- Handles new files, deleted files, renames, and binary files gracefully
- Hunk headers with line ranges

### History
- Full commit log across **all refs** (`--all`, topo-ordered) with up to 900
  commits
- **SVG branch/merge graph** drawn from real parent relationships: one lane
  per concurrent line of development, curves for merges
- Ref badges: **HEAD** (gold), local branches (purple), remote-tracking
  branches (blue), tags (amber)
- Click any commit to read its full message, author, date, parent hashes, and
  complete diff
- **Cherry-pick** or **revert** any commit onto the current branch (merge
  commits use their first parent as mainline)

### Branches
- Local branch list with the current branch highlighted, plus upstream
  tracking arrows (`main -> origin/main`)
- **Create** a branch and switch to it in one action
- **Switch** (with a clean checkout), **merge** (`--no-edit`), and **delete**
  (safe `-d`, refuses unmerged branches like git does)
- Remote-tracking branch list and configured remotes with their fetch URLs

### Push / pull
- **Push** uses the existing upstream; on the first push it sets one
  automatically (`git push -u <remote> <branch>`)
- **Pull** with `--no-edit` so merges never block on an editor
- **Fetch** all remotes with pruning
- When a remote asks for a username, password, token, SSH passphrase, or
  host-key confirmation, GitDeck shows a **credential dialog** instead of
  failing (see [Credential prompts](#credential-prompts))
- **Ahead/behind counters** next to the branch pill (`↓2 ↑1`)
- **Pull mode** (merge or rebase) is a setting; a rebase that stops on a
  conflict lands you in the conflict view with Continue / Abort

### Line staging, editing, and merging
- **Line-level staging**: in the unified diff, click lines to pick them, then
  **Stage lines**, **Unstage lines**, or **Discard lines** for just those rows
- **Word-level highlighting** of what changed inside a modified line
- **Edit** any working-tree text file in place (Ctrl+S saves; CRLF line
  endings are kept)
- **Three-way merge editor**: each conflict shows ours, theirs, and (on
  demand) the merge base; pick a side or both orders per conflict, or edit the
  result freely, then **Save & mark resolved**
- **Blame at older revisions**: step to the file as it was before any line's
  commit

### History, tags, and rebase
- **Filter** history by subject, author, branch/tag name, or hash prefix, and switch to the **reflog**
- **Multi-select** commits (Ctrl/Shift+click) and cherry-pick them in order
- **Tags**: create (lightweight or annotated) on any commit, push, delete
  locally or on a remote
- **Interactive rebase**: reorder, reword, squash, fixup, or drop commits from
  a chosen base
- **Commit template**: `commit.template` pre-fills the message box

### Branches, remotes, stashes
- **Rename** a branch; **add** and **remove** remotes
- **Stash selected files** only, from the stash view or a file's detail pane

### Repository
- **Clone**: clone any repository by URL into a parent directory you pick; the
  directory name is derived from the URL (and editable), the resulting path is
  shown live, and the finished clone opens as a tab
- **Tabs**: several repositories open at once; tabs and per-repository commit
  drafts are kept across switches and restored at launch
- **Submodules**: status, update one or all, open one in its own tab
- **Worktrees**: list, add (new or existing branch), open, remove
- **Git LFS**: tracked patterns and file counts, **LFS pull**

### GitHub pull requests
- List open/closed/all pull requests for a GitHub `origin`, read the
  description and comments rendered as Markdown, **check out** a pull request
  locally, **create** one from the current branch, or **open in browser**
- The token comes from `GH_TOKEN` / `GITHUB_TOKEN` or your git credential
  helper (`git credential fill` for github.com); it never leaves the main
  process

### Settings
- **Light / dark / system theme** (toolbar toggle and Settings dialog)
- **Custom git executable**: point GitDeck at any `git` binary; a path that
  does not run `git --version` is rejected and PATH git stays in use

## Interface overview

```
+----------------------------------------------------------------------+
| (o) GitDeck | Open Repository | ~/myrepo | (main) | ↓0 ↑1 | PULL PUSH |
+----------+---------------------------+-------------------------------+
|          | STAGED (2)        [unstage all] | file-a.txt     A   [-]   |
| WORKING  |   src/app.js      A   [-]       |                                |
| TREE (5) |--------------------------------|  diff --git a/...            |
|          | CHANGES (3)       [stage all]   |  @@ -10,3 +10,4 @@           |
| HISTORY  |   README.md       M   [+]       |  -old line                   |
|          |   lib/x.js        M   [+]       |  +new line                   |
| BRANCHES |   notes.txt       ?   [+]       |                               |
|          |--------------------------------|                               |
|          | [ commit message          ]    |                               |
| (a1b2c3) | [ Commit ]                   |                               |
+----------+-----------------------------+-------------------------------+
| status messages appear here                                          |
+----------------------------------------------------------------------+
```

## Requirements

- **Node.js 22+** (tested on 22.23)
- **git 2.28+** on your `PATH` (anything from 2020 onward; `git switch` and
  `init -b` are used)
- A display; on Linux this can be X11 or Wayland (WSLg works out of the box)

## Getting started

```bash
git clone https://github.com/azharieffendy/gitdeck.git
cd gitdeck
npm install
npm start
```

Then click **Open Repository** and pick any repository on your machine.

## Usage guide

### Opening a repository

Click **Open Repository** in the toolbar. GitDeck resolves the repository
root with `git rev-parse --show-toplevel`, so you can select any
subdirectory of a repository. The branch pill and ahead/behind counters
appear once a repository is open.

To start from a remote instead, click **Clone**: paste the repository URL,
pick a parent directory, and adjust the directory name if you like — the
resulting path is shown live, and the finished clone opens as a tab.
Destructive actions (discard, delete, drop, abort, history rewrites) ask in
the app's own styled dialog, never a plain browser pop-up.

### Staging and committing

The **Working Tree** view has two sections:

- **Staged** — files that will be included in the next commit. The `[-]`
  button on each row unstages that file (`git reset HEAD -- <path>`).
- **Changes** — modified and untracked files. The `[+]` button stages that
  file (`git add -- <path>`).

Use **Stage all** / **Unstage all** for bulk operations. With at least one
file staged, type a message into the commit box and press **Commit**.

### Reading diffs

Click any file row to open its diff in the right pane. Staged files show the
index diff; changed files show the working-tree diff; untracked files explain
that they are new and offer staging. In **History**, click any commit row to
see the commit metadata followed by its full diff.

### Walking history

Switch to **History**. The graph on the left is generated from each commit's
parent list: straight lanes are linear history, curves into a lane are
merges, and lane colors distinguish concurrent lines of development. Badges
next to each subject show where refs point.

### Managing branches

Switch to **Branches**. Type a name and press **Create** to make a new
branch and check it out immediately. Use **Switch** to check out another
branch, **Merge** to merge it into the current one, and **Delete** to remove
it (git will refuse if it is not fully merged — that is intentional).

### Syncing with remotes

**Pull** and **Push** act on the current branch. The first push for a branch
sets its upstream automatically. Ahead/behind counts show next to the branch
pill whenever an upstream exists.

## Command-line reference

| Flag | Effect |
| --- | --- |
| `--path=<repo>` | Open the given repository at launch |
| `--view=worktree\|history\|branches` | Start in a specific view (with `--path`) |
| `--smoke` | Headless self-check: boots the window, fails on any renderer console error, prints a DOM probe |
| `--shot=<file.png>` | Capture a screenshot of the window after load (disables GPU for software compositing) |

Examples:

```bash
npx electron . --path="$HOME/work/myrepo"
npx electron . --path="$HOME/work/myrepo" --view=history
npm run smoke
```

## Architecture

GitDeck is a standard three-part Electron application with one extra rule:
**all git knowledge lives outside Electron** so it can be tested without a
GUI.

```
+---------------------+  contextBridge   +----------------------+
|  renderer (app.js)  | <--------------- |  preload.js          |
|  DOM, views, state  |   gd:* channels  |  allowlisted IPC     |
+---------------------+                  +----------------------+
                                                    | ipcMain.handle
                                                    v
                                         +----------------------+
                                         |  main.js             |
                                         |  window, dialogs     |
                                         +----------------------+
                                                    | requires
                                                    v
                                         +----------------------+
                                         |  git.js              |
                                         |  git CLI wrapper     |
                                         |  (plain Node)        |
                                         +----------------------+
```

### Files

| Path | Role |
| --- | --- |
| `main.js` | Electron main process: window creation, native dialogs, smoke/screenshot test hooks, WSL compatibility switches |
| `ipc.js` | Every `gd:*` channel, mapped onto the git and GitHub layers |
| `preload.js` | `contextBridge` that forwards only `gd:`-prefixed channels |
| `git.js` | Core git integration: spawns `git -C <repo> ...`, parses output. No Electron imports — runs under plain Node for tests |
| `git-more.js` | Tags, remotes, reflog, interactive rebase, merge-editor I/O, submodules, worktrees, LFS, file read/write, commit template |
| `github.js` | GitHub REST client for pull requests (token from env or the git credential helper) |
| `editor/editor.js` | `GIT_SEQUENCE_EDITOR` / `GIT_EDITOR` helper that feeds the interactive-rebase plan to git |
| `askpass/` | Credential prompt helper and its local socket server |
| `renderer/index.html` | Page shell with a strict CSP |
| `renderer/app.js` | View state, working tree, diff detail pane, toolbar |
| `renderer/history.js`, `rebase.js`, `refs.js`, `conflict.js`, `pulls.js`, `repo.js`, `tabs.js`, `settings.js` | One view or feature each |
| `renderer/diff.js` | Unified-diff parser, word diff, line patches, HTML renderer (`window.GitDiff`) |
| `renderer/merge.js` | Conflict-marker parser and resolver (`window.GitMerge`) |
| `renderer/markdown.js` | Small, escaping Markdown renderer for pull requests (`window.GitMarkdown`) |
| `renderer/graph.js` | Commit-graph lane layout and SVG generation (`window.GitGraph`) |
| `renderer/styles.css` | The complete design system, dark and light |
| `test/*.test.js` | Renderer units, git-layer integration, feature integration, askpass round trip |

### IPC channel reference

| Channel | Payload | Returns |
| --- | --- | --- |
| `gd:openDialog` | — | repository toplevel path or null |
| `gd:openPath` | `{path}` | resolved toplevel |
| `gd:clone` | `{url, parent, name}` | new repository path |
| `gd:status` | `{repo}` | `{staged, unstaged, untracked}` |
| `gd:stagePaths` | `{repo, paths[]}` | — |
| `gd:stageAll` | `{repo}` | — |
| `gd:unstagePaths` | `{repo, paths[]}` | — |
| `gd:unstageAll` | `{repo}` | — |
| `gd:commit` | `{repo, message}` | new head info |
| `gd:diffWorking` | `{repo, path?}` | unified diff text |
| `gd:diffStaged` | `{repo, path?}` | unified diff text |
| `gd:commitInfo` | `{repo, hash}` | `{meta, diff}` |
| `gd:log` | `{repo}` | commit list with parents and refs |
| `gd:branches` | `{repo}` | `{local[], remote[]}` |
| `gd:remotes` | `{repo}` | remote list with fetch/push URLs |
| `gd:createBranch` | `{repo, name, from?}` | — |
| `gd:switchBranch` | `{repo, name}` | — |
| `gd:merge` | `{repo, name}` | — |
| `gd:deleteBranch` | `{repo, name, force?}` | — |
| `gd:push` / `gd:pull` | `{repo}` | sync result |
| `gd:refresh` | `{repo}` | everything the UI needs in one round trip |

### Data flow of one action

When you press a `[+]` stage button: `app.js` calls the preload bridge with
`gd:stagePaths`; the main process runs `git stage` through `git.js`; the
result flows back; the renderer calls `gd:refresh`, which batches status,
branch, log, branch list, remotes, ahead/behind, and head info in a single
request; the current view re-renders. One user action, two IPC round trips,
no polling.

## The git layer

`git.js` shells out to the git CLI rather than linking a library. That
choice keeps the dependency surface at zero, behaves exactly like the git
you use in a terminal (including your config, hooks, credentials, and
attribute files), and makes every parse failure visible instead of hidden
inside a binding.

Parsing details worth knowing:

- Status uses `--porcelain=v1 -z` with NUL separators, so paths containing
  spaces, quotes, or non-ASCII characters survive intact. Rename records
  consume their second path record per the porcelain contract.
- Ref decorations come from `--format=%D`, including the `HEAD -> branch`
  form, and are classified into local, remote-tracking, and tag badges.
- Branches are read from `%(refname)` and classified by `refs/heads/` vs
  `refs/remotes/` prefixes, which is immune to branch names containing `/`.
- Unstaging uses `git reset HEAD --` normally, and falls back to
  `git rm --cached` in a repository with no commits yet, where `HEAD` does
  not exist.
- The first push checks for an upstream with `rev-parse --abbrev-ref
  @{upstream}` and adds `-u` only when it is missing.

## The history graph

The graph is computed in `renderer/graph.js` from the parent hashes of every
commit — the same information `git log --graph` uses, laid out by GitDeck:

1. Commits arrive in topo order. A **lane** is a slot that tracks which
   commit will continue that line next.
2. A commit's first parent **continues its lane**; every additional parent
   gets its own lane — that is what makes merge forks visible.
3. Edges are drawn as cubic bezier curves between the commit node and each
   parent node, colored by the parent's lane.
4. Lanes whose line has ended are closed and trailing closed lanes are
   compacted, so long histories stay narrow.

The result is an SVG with one 30-pixel row per commit, aligned with the
commit table beside it.

## The diff engine

`renderer/diff.js` parses standard unified diff text produced by
`git diff --no-color`:

- File sections from `diff --git a/... b/...` headers, with `new file`,
  `deleted file`, `rename from/to`, and `Binary files` detection
- Hunk tracking with running old/new line numbering so both gutter columns
  are exact
- HTML escaping for every line of content; the renderer never injects raw
  diff text into the DOM
- Per-file addition/deletion totals for the header statistics

## Design system

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0d1117` | application background |
| `--surface` | `#161b22` | toolbar, sidebar, headers |
| `--raised` | `#1f2630` | hover and selected rows |
| `--border` | `#30363d` | all dividers |
| `--text` / `--muted` | `#e6edf3` / `#8b949e` | primary and secondary text |
| `--accent` | `#58a6ff` | focus, selection, counts |
| `--add` / `--del` | `#3fb950` / `#f85149` | additions, deletions |
| `--warn` / `--merge` | `#d29922` / `#bc8cff` | HEAD/tags, branch references |

- Spacing scale: **4, 8, 12, 16, 24, 32, 48** — nothing in between
- Type scale: **12, 13 (rows), 14, 16, 20** with a monospace stack for all
  git content and a sans stack for chrome
- Visible focus rings on every interactive element, and hover states that
  reveal per-row actions instead of permanent chrome

## Credential prompts

git and ssh never read from a terminal under GitDeck (`GIT_TERMINAL_PROMPT=0`).
Instead, every git process is started with `GIT_ASKPASS` and `SSH_ASKPASS`
pointing at a small helper:

1. At startup the main process opens a local socket (a named pipe on Windows,
   a Unix socket in a private temp directory elsewhere) and writes a wrapper
   script (`askpass.cmd` / `askpass.sh`) that runs `askpass/client.js` with
   Electron's own Node runtime.
2. When git or ssh needs an answer, it runs the wrapper with the prompt text.
   The helper sends the prompt plus a random per-session token to the socket.
3. The main process checks the token, shows the dialog in the window, and
   returns what you typed. **Cancel** or **Escape** makes the helper exit with
   an error, so git stops cleanly.

The dialog adapts to the prompt: passwords, tokens, and passphrases are
masked with a Show/Hide toggle. Unknown SSH host keys ask for a yes/no
answer, and **No** is the default. Prompts that arrive together are queued.
Nothing you type is stored by GitDeck.

Notes:
- Your configured credential helper (Git Credential Manager, libsecret,
  osxkeychain) still runs first. The dialog only appears when it has nothing
  to offer, and git saves accepted credentials there as usual.
- SSH prompts need OpenSSH 8.4 or newer, which honours `SSH_ASKPASS_REQUIRE=force`.
  Older ssh only uses the helper when it has no terminal. An `ssh-agent` with
  the key loaded avoids the prompt entirely.

## Security model

- `contextIsolation: true`, `nodeIntegration: false`
- The preload bridge forwards **only** channels whose name starts with `gd:`
- A `Content-Security-Policy` meta tag restricts the page to `'self'` for
  scripts and styles
- No remote content is ever loaded; the renderer is local files only
- Repositories are never executed or trusted beyond git's own parsing; the
  app runs git, it does not interpret repository data itself
- The askpass socket answers only callers presenting the per-session token
  (constant-time compare), requests are size-capped, and pending prompts are
  cancelled when the window reloads, crashes, or closes

## Testing

```bash
npm test        # renderer units (10) + git layer (33) + features (21) + askpass round trip (4)
npm run smoke   # boots the app, asserts zero renderer console errors
```

The askpass suite drives a real `git credential fill` through the helper and
socket, and checks cancellation and a forged token. The git-layer suite also
covers hunk stage/unstage/discard via `git apply`, amend, stash
save/list/diff/pop/drop, cherry-pick, revert, abort of a conflicting
cherry-pick, conflict resolution followed by continuing a merge, and blame.

Both suites run unchanged on Windows and Linux; they also cover non-ASCII
paths, remote URLs with spaces, merge-conflict detection, and rejection of
option-like branch names and hashes.

The integration suite covers, in order: repository root resolution,
untracked detection, staging and index state, staged diff content,
unstaging, commit and head resolution, modification detection with working
diffs, multi-commit log with HEAD marking, branch create and switch, a
divergent merge producing a two-parent merge commit, push with automatic
upstream, a clone committing and pushing independently, pulling the foreign
commit, branch and remote listings, merged-branch deletion, and commit
metadata/diff retrieval. Each run builds fresh repositories in a temp
directory, so the suite is repeatable and side-effect free.

The smoke run additionally probes the DOM (rendered row, commit, graph node,
and edge counts) so a rendering regression fails the build, not just a
console error.

## Running on Windows

Install [Git for Windows](https://git-scm.com/download/win) so `git` is on
`PATH`, then `npm install && npm start`. git commands run without console
windows, paths are returned in native `C:\...` form, and CRLF files diff
cleanly. HTTPS pushes use Git Credential Manager, which ships with Git for
Windows.

## Running on Linux

`sudo apt install git` (or your distro's equivalent), then `npm install && npm start`.

Ubuntu 23.10+ blocks the unprivileged user namespaces Chromium's sandbox
needs, and an npm-installed Electron has no setuid `chrome-sandbox` helper.
GitDeck detects this and starts with `--no-sandbox` (with a warning on
stderr). To keep the sandbox on instead, make the helper setuid root:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Set `GITDECK_NO_SANDBOX=1` to force `--no-sandbox` on other locked-down
systems. git runs with `GIT_TERMINAL_PROMPT=0`, so a push that needs
credentials fails fast instead of hanging; configure a credential helper
(`git config --global credential.helper store` or `libsecret`) or use SSH.

## Running under WSL

GitDeck runs under WSLg without extra setup. Two WSL-specific switches are
applied automatically when `WSL_DISTRO_NAME` or `WSL_INTEROP` is set:

- `--no-sandbox` — Chromium's sandbox needs user namespaces that WSL has
  historically not exposed
- `--no-zygote` — without this, Chromium's helper processes fail `access()`
  with `ESRCH` under WSL and flood the terminal with
  `platform_shared_memory_region_posix` errors; the app still works, but the
  log spam is unusable. This switch eliminates it entirely.
- `--disable-dev-shm-usage` — works around `/dev/shm` size and permission
  quirks in some WSL distributions

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Blank window on Linux | No display, or a very old GPU driver. Run with `--disable-gpu` |
| `The SUID sandbox helper binary was found, but is not configured correctly` | Locked-down Linux sandbox. See [Running on Linux](#running-on-linux), or set `GITDECK_NO_SANDBOX=1` |
| Push fails with `terminal prompts disabled` | No credential helper is configured. See [Running on Linux](#running-on-linux) |
| `git: command not found` | git is not on the `PATH` Electron inherits. Install git, launch from a shell where it is available, or set the git executable in Settings (&#9881;) |
| Push fails with auth error | GitDeck uses your standard git credential helper. Authenticate once in a terminal (`git push` in the repo) and retry |
| Commit button disabled | Nothing is staged. Stage at least one file first |
| Delete branch refused | The branch is not merged. That is git protecting you; merge it first or force in a terminal if you are certain |
| `platform_shared_memory_region_posix` error flood on WSL | Known Chromium/WSL interop quirk. GitDeck applies `--no-zygote` automatically and the errors do not occur |

## Roadmap

- [x] Hunk-level staging
- [x] Side-by-side diff mode
- [x] Stash list, apply, and drop
- [x] Conflict resolver view (whole-side resolution)
- [x] Credential prompt dialog
- [x] Line-level staging, word diff, in-place file editing
- [x] Three-way merge editor
- [x] Interactive rebase, pull with rebase
- [x] Tags, branch rename, remote add/remove, reflog, multi-commit cherry-pick
- [x] GitHub pull requests (list, read, check out, create)
- [x] Repository tabs, submodules, worktrees, LFS
- [x] Clone by URL; styled confirmation dialogs
- [x] Light theme, configurable git executable
- [ ] Packaged installers (AppImage, NSIS, dmg)
- [ ] Bundled git (needs a GPL-compliant packaging decision)
- [ ] GitLab / Bitbucket pull requests
- [ ] git-flow

## Contributing

Issues and pull requests are welcome. Keep the architecture rule in mind:
git logic belongs in `git.js` with a test, UI logic belongs in the renderer,
and the bridge between them stays allowlisted. Run `npm test` and
`npm run smoke` before submitting.

## License

[MIT](LICENSE) — free to use, modify, and redistribute.

## Acknowledgments

GitDeck's workflow is inspired by the long tradition of Git GUIs, and by the
questions people ask when learning how version control actually works. The
implementation is original. Electron and the git project do the heavy
lifting; this repository is the deck built on top of them.
