import * as vscode from 'vscode';
import { BlameCache } from './blameCache';
import { CommitInfo, commitMessage } from './git';
import {
  absoluteDate,
  DateFormat,
  GUTTER_WIDTH,
  gutterText,
  inlineText,
  relativeTime,
  shortSha,
} from './format';

const inlineDecoration = vscode.window.createTextEditorDecorationType({
  after: {
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
    fontStyle: 'italic',
    margin: '0 0 0 3em',
  },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
});

const gutterDecoration = vscode.window.createTextEditorDecorationType({
  before: {
    color: new vscode.ThemeColor('editorCodeLens.foreground'),
    backgroundColor: new vscode.ThemeColor('editor.lineHighlightBackground'),
    width: `${GUTTER_WIDTH + 2}ch`,
    margin: '0 1.5em 0 0',
  },
});

function nbsp(s: string): string {
  // Decoration text collapses regular whitespace; keep columns aligned.
  return s.replace(/ /g, ' ');
}

function hover(c: CommitInfo, message?: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  if (c.uncommitted) {
    md.appendMarkdown('**Not committed yet**');
    return md;
  }
  md.appendMarkdown(`**${escape(c.author)}** `);
  if (c.authorMail) {
    md.appendMarkdown(`<${escape(c.authorMail)}>`);
  }
  md.appendMarkdown(`\n\n${absoluteDate(c.authorTime)} (${relativeTime(c.authorTime)})`);
  md.appendMarkdown(` · \`${shortSha(c.sha)}\``);
  md.appendMarkdown('\n\n---\n\n');
  md.appendText(message ?? c.summary);
  md.appendMarkdown(`\n\n---\n\n\`${c.sha}\``);
  return md;
}

function escape(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!<>|]/g, '\\$&');
}

/** Renders inline (current line) and full-file blame decorations plus the status bar. */
export class BlameDecorator implements vscode.Disposable {
  fileBlameEnabled = false;
  private statusBar: vscode.StatusBarItem;
  private renderTimer: NodeJS.Timeout | undefined;
  private renderSeq = 0;

  constructor(private cache: BlameCache) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBar.command = 'gitBlame.toggleFileBlame';
    this.statusBar.tooltip = 'Toggle file blame';
  }

  private get config() {
    const cfg = vscode.workspace.getConfiguration('gitBlame');
    return {
      inlineEnabled: cfg.get<boolean>('inlineEnabled', true),
      dateFormat: cfg.get<DateFormat>('dateFormat', 'relative'),
    };
  }

  /** Schedule a re-render of the active editor. */
  scheduleRender(delay = 100): void {
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => void this.render(), delay);
  }

  async render(): Promise<void> {
    const seq = ++this.renderSeq;
    const editor = vscode.window.activeTextEditor;
    for (const e of vscode.window.visibleTextEditors) {
      if (e !== editor) {
        e.setDecorations(inlineDecoration, []);
        e.setDecorations(gutterDecoration, []);
      }
    }
    if (!editor) {
      this.statusBar.hide();
      return;
    }
    const doc = editor.document;
    const result = await this.cache.get(doc);
    // Bail if a newer render started or the editor changed meanwhile.
    if (seq !== this.renderSeq || editor !== vscode.window.activeTextEditor) {
      return;
    }
    if (!result || result.lines.length === 0) {
      editor.setDecorations(inlineDecoration, []);
      editor.setDecorations(gutterDecoration, []);
      this.statusBar.hide();
      return;
    }

    const { inlineEnabled, dateFormat } = this.config;
    const line = editor.selection.active.line;
    const commit = result.lines[line];

    this.renderGutter(editor, result.lines);

    if (commit) {
      this.statusBar.text = commit.uncommitted
        ? '$(git-commit) Not committed yet'
        : `$(git-commit) ${commit.author}, ${relativeTime(commit.authorTime)}`;
      this.statusBar.show();
    } else {
      this.statusBar.hide();
    }

    if (!inlineEnabled || !commit || this.fileBlameEnabled) {
      editor.setDecorations(inlineDecoration, []);
      return;
    }
    let message: string | undefined;
    if (!commit.uncommitted) {
      message = await commitMessage(result.repoRoot, commit.sha).catch(() => undefined);
      if (seq !== this.renderSeq) {
        return;
      }
    }
    const end = doc.lineAt(line).range.end;
    editor.setDecorations(inlineDecoration, [
      {
        range: new vscode.Range(end, end),
        hoverMessage: hover(commit, message),
        renderOptions: { after: { contentText: inlineText(commit, dateFormat) } },
      },
    ]);
  }

  private renderGutter(editor: vscode.TextEditor, lines: CommitInfo[]): void {
    if (!this.fileBlameEnabled) {
      editor.setDecorations(gutterDecoration, []);
      return;
    }
    const decorations: vscode.DecorationOptions[] = [];
    let prevSha: string | undefined;
    const lineCount = editor.document.lineCount;
    for (let i = 0; i < Math.min(lines.length, lineCount); i++) {
      const c = lines[i];
      if (!c) {
        continue;
      }
      // Only label the first line of each consecutive run of the same commit.
      const text = c.sha === prevSha ? '' : gutterText(c);
      prevSha = c.sha;
      const start = new vscode.Position(i, 0);
      decorations.push({
        range: new vscode.Range(start, start),
        hoverMessage: hover(c),
        renderOptions: { before: { contentText: nbsp(text) || ' ' } },
      });
    }
    editor.setDecorations(gutterDecoration, decorations);
  }

  dispose(): void {
    clearTimeout(this.renderTimer);
    this.statusBar.dispose();
    inlineDecoration.dispose();
    gutterDecoration.dispose();
  }
}
