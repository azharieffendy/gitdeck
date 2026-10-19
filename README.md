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
13. [Security model](#security-model)
14. [Testing](#testing)
15. [Running under WSL](#running-under-wsl)
16. [Troubleshooting](#troubleshooting)
17. [Roadmap](#roadmap)
18. [Contributing](#contributing)
19. [License](#license)
20. [Acknowledgments](#acknowledgments)

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
- Commit box with message validation and a live staged-file counter

### Diff viewer
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
- **Ahead/behind counters** next to the branch pill (`↓2 ↑1`)

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
| `main.js` | Electron main process: window creation, native dialogs, one IPC handler per operation, smoke/screenshot test hooks, WSL compatibility switches |
| `preload.js` | `contextBridge` that forwards only `gd:`-prefixed channels |
| `git.js` | The entire git integration: spawns `git -C <repo> ...`, parses output, exposes 20+ async functions. No Electron imports — runs under plain Node for tests |
| `renderer/index.html` | Page shell with a strict CSP |
| `renderer/app.js` | View state machine and all UI wiring (working tree, history, branches, toolbar) |
| `renderer/diff.js` | Unified-diff parser and HTML renderer (`window.GitDiff`) |
| `renderer/graph.js` | Commit-graph lane layout and SVG generation (`window.GitGraph`) |
| `renderer/styles.css` | The complete design system |
| `test/git-layer.test.js` | 17-scenario integration test against a real repository and bare remote |

### IPC channel reference

| Channel | Payload | Returns |
| --- | --- | --- |
| `gd:openDialog` | — | repository toplevel path or null |
| `gd:openPath` | `{path}` | resolved toplevel |
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

## Security model

- `contextIsolation: true`, `nodeIntegration: false`
- The preload bridge forwards **only** channels whose name starts with `gd:`
- A `Content-Security-Policy` meta tag restricts the page to `'self'` for
  scripts and styles
- No remote content is ever loaded; the renderer is local files only
- Repositories are never executed or trusted beyond git's own parsing; the
  app runs git, it does not interpret repository data itself

## Testing

```bash
npm test        # git layer: 17 scenarios, real repo + bare remote
npm run smoke   # boots the app, asserts zero renderer console errors
```

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

## Running under WSL

GitDeck runs under WSLg without extra setup. Two WSL-specific switches are
applied automatically when `WSL_DISTRO_NAME` or `WSL_INTEROP` is set:

- `--no-sandbox` — Chromium's sandbox needs user namespaces that WSL has
  historically not exposed
- `--disable-dev-shm-usage` — works around `/dev/shm` size and permission
  quirks in some WSL distributions

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Blank window on Linux | No display, or a very old GPU driver. Run with `--disable-gpu` |
| `git: command not found` | git is not on the `PATH` Electron inherits. Install git or launch from a shell where it is available |
| Push fails with auth error | GitDeck uses your standard git credential helper. Authenticate once in a terminal (`git push` in the repo) and retry |
| Commit button disabled | Nothing is staged. Stage at least one file first |
| Delete branch refused | The branch is not merged. That is git protecting you; merge it first or force in a terminal if you are certain |
| `/dev/shm` errors in logs | Cosmetic on WSL; the mitigation switch is already applied |

## Roadmap

- [ ] Hunk-level staging
- [ ] Side-by-side diff mode
- [ ] Stash list, apply, and drop
- [ ] Interactive rebase support
- [ ] Conflict resolver view
- [ ] Repository tab bar for multiple open repositories
- [ ] Light theme
- [ ] Packaged installers (AppImage, NSIS, dmg)

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
