import * as vscode from 'vscode';
import { blame, FileBlame, getRepoRoot } from './git';

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
    if (doc.uri.scheme !== 'file') {
      return Promise.resolve(undefined);
    }
    const key = doc.uri.toString();
    const cached = this.entries.get(key);
    if (cached && cached.version === doc.version) {
      return cached.result;
    }
    const result = this.compute(doc);
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
    const file = doc.uri.fsPath;
    const repoRoot = await getRepoRoot(file);
    if (!repoRoot) {
      return undefined;
    }
    try {
      const lines = await blame(file, doc.isDirty ? doc.getText() : undefined);
      return { repoRoot, lines };
    } catch {
      // Untracked or ignored file.
      return undefined;
    }
  }
}
