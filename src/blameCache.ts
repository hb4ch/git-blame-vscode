import * as vscode from 'vscode';
import { blame, blameRevision, FileBlame, getRepoRoot } from './git';
import { EMPTY_REV, fromRevisionUri } from './revision';

export interface DocumentBlame {
  repoRoot: string;
  lines: FileBlame;
}

interface Entry {
  version: number;
  result: Promise<DocumentBlame | undefined>;
}

/** Caches blame per document version. Resolves undefined for files not tracked by git. */
export class BlameCache {
  private entries = new Map<string, Entry>();

  get(doc: vscode.TextDocument): Promise<DocumentBlame | undefined> {
    const key = doc.uri.toString();
    const cached = this.entries.get(key);
    if (cached && cached.version === doc.version) {
      return cached.result;
    }
    const result = this.compute(doc).catch(() => undefined);
    this.entries.set(key, { version: doc.version, result });
    return result;
  }

  delete(uri: vscode.Uri): void {
    this.entries.delete(uri.toString());
  }

  clear(): void {
    this.entries.clear();
  }

  private async compute(doc: vscode.TextDocument): Promise<DocumentBlame | undefined> {
    const rev = fromRevisionUri(doc.uri);
    if (rev) {
      if (rev.sha === EMPTY_REV) {
        return undefined;
      }
      const lines = await blameRevision(rev.repoRoot, rev.sha, rev.filename);
      return { repoRoot: rev.repoRoot, lines };
    }
    if (doc.uri.scheme !== 'file') {
      return undefined;
    }
    const file = doc.uri.fsPath;
    const repoRoot = await getRepoRoot(file);
    if (!repoRoot) {
      return undefined;
    }
    // Rejects for untracked or ignored files; get() maps that to undefined.
    const lines = await blame(repoRoot, file, doc.isDirty ? doc.getText() : undefined);
    return { repoRoot, lines };
  }
}
