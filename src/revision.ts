import * as vscode from 'vscode';
import { showFile } from './git';

/** URI scheme for read-only documents showing a file at a given commit. */
export const REVISION_SCHEME = 'gitblame-rev';

/** Pseudo-revision with empty content, the "before" side of a file's first commit. */
export const EMPTY_REV = 'empty';

export interface RevisionRef {
  repoRoot: string;
  sha: string;
  /** Relative to the repo root. */
  filename: string;
}

export function toRevisionUri(ref: RevisionRef): vscode.Uri {
  // Keep the file name in the path so VS Code picks the right language mode.
  return vscode.Uri.from({
    scheme: REVISION_SCHEME,
    path: `/${ref.sha.slice(0, 7)}/${ref.filename}`,
    query: JSON.stringify(ref),
  });
}

export function fromRevisionUri(uri: vscode.Uri): RevisionRef | undefined {
  if (uri.scheme !== REVISION_SCHEME) {
    return undefined;
  }
  try {
    return JSON.parse(uri.query) as RevisionRef;
  } catch {
    return undefined;
  }
}

export class RevisionContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const ref = fromRevisionUri(uri);
    if (!ref || ref.sha === EMPTY_REV) {
      return '';
    }
    return showFile(ref.repoRoot, ref.sha, ref.filename);
  }
}
