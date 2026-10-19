# GitDeck

An original, open desktop Git client built with Electron. Browse the working
tree, stage and commit, inspect diffs, walk the history graph, manage branches,
and push/pull with remotes.

GitDeck is an independent implementation and is not affiliated with, nor derived
from, any proprietary Git client. All code is original and MIT-licensed.

## Features

- **Working tree** — staged/unstaged/untracked changes with per-file stage and
  unstage actions, stage-all, and a commit box
- **Diff viewer** — unified diffs for working tree, index, and any commit with
  line numbers and add/delete highlighting
- **History** — commit log with an SVG branch/merge graph, refs (branches,
  tags, HEAD), authors and dates
- **Branches** — create, switch, merge, delete; local and remote-tracking
  lists; remote URLs
- **Push / Pull** — sets upstream on first push (`-u`), shows ahead/behind

## Run

Requirements: Node.js 22+ and git on PATH.

    npm install
    npm start          # opens the app
    npm test           # 17 integration tests for the git layer (real repo + bare remote)
    npm run smoke      # headless boot check (window loads, no console errors)

CLI conveniences:

    npx electron . --path=/path/to/repo            # open a repo directly
    npx electron . --path=/path/to/repo --view=history

## Architecture

    main.js      Electron main process: window, dialogs, IPC handlers
    preload.js   contextBridge exposing a gd:* allowlisted API
    git.js       git CLI wrapper (plain Node — no Electron dependency, unit-testable)
    renderer/    UI: app.js (logic), diff.js (unified diff), graph.js (lane layout), styles.css

Security: contextIsolation on, nodeIntegration off, CSP in the page, and the
preload bridge only forwards `gd:` channels.

## Roadmap ideas

Hunk-level staging, credential helpers UI, stash support, interactive rebase,
side-by-side diffs, dark/light themes.

## License

MIT
