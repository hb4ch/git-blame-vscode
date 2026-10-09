import * as path from 'path';
import * as vscode from 'vscode';
import { BlameCache } from './blameCache';
import { commitWebUrl, getRemote, LineBlame, UNCOMMITTED_SHA } from './git';
import { shortSha } from './format';
import { EMPTY_REV, toRevisionUri } from './revision';

/** Everything a command needs about one blamed line. Passed as JSON from hover links. */
export interface BlameTarget {
  repoRoot: string;
  sha: string;
  filename: string;
  origLine: number;
  previous?: { sha: string; filename: string };
}

export function toTarget(repoRoot: string, line: LineBlame): BlameTarget {
  return {
    repoRoot,
    sha: line.commit.sha,
    filename: line.filename,
    origLine: line.origLine,
    previous: line.previous,
  };
}

/** `command:` URI usable as a Markdown link in a trusted hover. */
export function commandUri(command: string, target: BlameTarget): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify([target]))}`;
}

export const COMMANDS = {
  showCommitDiff: 'gitBlame.showCommitDiff',
  blamePrevious: 'gitBlame.blamePreviousRevision',
  openOnRemote: 'gitBlame.openCommitOnRemote',
};

/** Target for the cursor line of the active editor, when invoked from the palette. */
async function activeTarget(cache: BlameCache): Promise<BlameTarget | undefined> {
  const editor = vscode.window.activeTextEditor;
  const result = editor && (await cache.get(editor.document));
  const line = result?.lines[editor!.selection.active.line];
  if (!result || !line) {
    void vscode.window.showInformationMessage('No git blame information for this line.');
    return undefined;
  }
  if (line.commit.sha === UNCOMMITTED_SHA) {
    void vscode.window.showInformationMessage('This line is not committed yet.');
    return undefined;
  }
  return toTarget(result.repoRoot, line);
}

function lineSelection(target: BlameTarget): vscode.Range {
  const pos = new vscode.Position(Math.max(target.origLine - 1, 0), 0);
  return new vscode.Range(pos, pos);
}

/** Opens a diff of the file as changed by the line's commit. */
async function showCommitDiff(target: BlameTarget): Promise<void> {
  const before = target.previous
    ? { repoRoot: target.repoRoot, ...target.previous }
    : { repoRoot: target.repoRoot, sha: EMPTY_REV, filename: target.filename };
  const after = { repoRoot: target.repoRoot, sha: target.sha, filename: target.filename };
  const beforeLabel = target.previous ? `${shortSha(target.sha)}^` : 'empty';
  await vscode.commands.executeCommand(
    'vscode.diff',
    toRevisionUri(before),
    toRevisionUri(after),
    `${path.basename(target.filename)} (${beforeLabel} ↔ ${shortSha(target.sha)})`,
    { selection: lineSelection(target), preview: true },
  );
}

/** Opens the file as it was just before the line's commit, so it can be blamed again. */
async function blamePrevious(target: BlameTarget): Promise<void> {
  if (!target.previous) {
    void vscode.window.showInformationMessage(
      `${shortSha(target.sha)} created this file; there is no earlier revision.`,
    );
    return;
  }
  const uri = toRevisionUri({ repoRoot: target.repoRoot, ...target.previous });
  const doc = await vscode.workspace.openTextDocument(uri);
  // Line numbers shift between revisions; the commit's own line number is a close guess.
  const line = Math.min(target.origLine - 1, doc.lineCount - 1);
  const pos = new vscode.Position(Math.max(line, 0), 0);
  await vscode.window.showTextDocument(doc, {
    selection: new vscode.Range(pos, pos),
    preview: true,
  });
}

async function openOnRemote(target: BlameTarget): Promise<void> {
  const remote = await getRemote(target.repoRoot);
  if (!remote) {
    void vscode.window.showInformationMessage('This repository has no recognizable remote.');
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(commitWebUrl(remote, target.sha)));
}

export function registerCommands(cache: BlameCache): vscode.Disposable[] {
  const wrap =
    (fn: (t: BlameTarget) => Promise<void>) =>
    async (target?: BlameTarget): Promise<void> => {
      const t = target ?? (await activeTarget(cache));
      if (t) {
        await fn(t);
      }
    };
  return [
    vscode.commands.registerCommand(COMMANDS.showCommitDiff, wrap(showCommitDiff)),
    vscode.commands.registerCommand(COMMANDS.blamePrevious, wrap(blamePrevious)),
    vscode.commands.registerCommand(COMMANDS.openOnRemote, wrap(openOnRemote)),
  ];
}
