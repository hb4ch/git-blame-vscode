# Line Git Blame

A VS Code extension that shows who last changed each line, and in which commit, for files tracked by git. Files outside a git repo, or untracked files, show nothing.

## Features

- **Current-line blame**: faded text at the end of the cursor's line, e.g. `Alice, 3 days ago • Fix parser bug`. Hover over it to see the full commit message, author email, date and hash.
- **File blame**: run **Git Blame: Toggle File Blame** (or click the status bar entry) to show `sha  author  date` before every line. Hover over an annotation for details.
- **Status bar**: author and age of the current line's commit.
- Works on unsaved edits: modified lines show as *Not committed yet*.
- Refreshes automatically after commits, checkouts and saves.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitBlame.inlineEnabled` | `true` | Show blame at the end of the current line. |
| `gitBlame.dateFormat` | `relative` | `relative` (3 days ago) or `absolute` (2026-10-06). |

## Requirements

`git` on your `PATH`.

## Development

```sh
npm install
npm run compile   # build to out/
npm test          # unit tests for the git blame parser
npm run package   # build a .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host. Install a built package with `code --install-extension line-git-blame-0.1.0.vsix`.
