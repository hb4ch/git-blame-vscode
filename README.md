# Line Git Blame

A VS Code extension that shows who last changed each line, and in which commit, for files tracked by git. Files outside a git repo, or untracked files, show nothing.

## Features

- **Current-line blame**: faded text at the end of the cursor's line, e.g. `Alice, 3 days ago • Fix parser bug`. Hover over it for the full commit message, author email, date and hash.
- **File blame**: run **Git Blame: Toggle File Blame** (or click the status bar entry) to show `sha  author  date` before every line. Hover over an annotation for details.
- **Accurate attribution**: whitespace-only changes are ignored, and lines moved or copied within or between files are traced back to the commit that originally wrote them (`git blame -w -M -C`).
- **Ignore bulk commits**: commits listed in a `.git-blame-ignore-revs` file at the repo root (formatter runs, mass renames) are skipped.
- **Hover actions**:
  - **Show diff**: opens the change the commit made to the file, at that line.
  - **Blame previous revision**: opens the file as it was just before that commit, with blame, so you can keep stepping back through a line's history.
  - **Open on GitHub / GitLab / Bitbucket**: opens the commit page for the `origin` remote.
  
  These are also commands in the Command Palette that act on the cursor's line.
- **Status bar**: author and age of the current line's commit.
- Works on unsaved edits: modified lines show as *Not committed yet*.
- Refreshes automatically after commits, checkouts, saves and edits to `.git-blame-ignore-revs`.

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
npm test          # unit tests for git blame and remote URL parsing
npm run package   # build a .vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host. Install a built package with `code --install-extension line-git-blame-0.2.0.vsix`.
