import * as vscode from 'vscode';
import { BlameCache } from './blameCache';
import { COMMANDS, commandUri, toTarget } from './commands';
import { commitMessage, commitWebUrl, getRemote, LineBlame, RemoteInfo } from './git';
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

function hover(
  repoRoot: string,
  line: LineBlame,
  remote: RemoteInfo | undefined,
  message?: string,
): vscode.MarkdownString {
  const c = line.commit;
  const md = new vscode.MarkdownString();
  if (c.uncommitted) {
    md.appendMarkdown('**Not committed yet**');
    return md;
  }
  md.isTrusted = { enabledCommands: Object.values(COMMANDS) };
  md.supportThemeIcons = true;
  md.appendMarkdown(`**${escape(c.author)}** `);
  if (c.authorMail) {
    md.appendMarkdown(`<${escape(c.authorMail)}>`);
  }
  md.appendMarkdown(`\n\n${absoluteDate(c.authorTime)} (${relativeTime(c.authorTime)})`);
  md.appendMarkdown(` · \`${shortSha(c.sha)}\``);
  md.appendMarkdown('\n\n---\n\n');
  md.appendText(message ?? c.summary);
  md.appendMarkdown('\n\n---\n\n');
  const target = toTarget(repoRoot, line);
  const links = [`[$(diff) Show diff](${commandUri(COMMANDS.showCommitDiff, target)})`];
  if (line.previous) {
    links.push(`[$(history) Blame previous revision](${commandUri(COMMANDS.blamePrevious, target)})`);
  }
  if (remote) {
    links.push(`[$(link-external) Open on ${escape(remote.name)}](${commitWebUrl(remote, c.sha)})`);
  }
  md.appendMarkdown(links.join(' &nbsp;|&nbsp; '));
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
    const blamed = result.lines[line];
    const remote = await getRemote(result.repoRoot);
    if (seq !== this.renderSeq) {
      return;
    }

    this.renderGutter(editor, result.repoRoot, result.lines, remote);

    if (blamed) {
      const c = blamed.commit;
      this.statusBar.text = c.uncommitted
        ? '$(git-commit) Not committed yet'
        : `$(git-commit) ${c.author}, ${relativeTime(c.authorTime)}`;
      this.statusBar.show();
    } else {
      this.statusBar.hide();
    }

    if (!inlineEnabled || !blamed || this.fileBlameEnabled) {
      editor.setDecorations(inlineDecoration, []);
      return;
    }
    let message: string | undefined;
    if (!blamed.commit.uncommitted) {
      message = await commitMessage(result.repoRoot, blamed.commit.sha).catch(() => undefined);
      if (seq !== this.renderSeq) {
        return;
      }
    }
    const end = doc.lineAt(line).range.end;
    editor.setDecorations(inlineDecoration, [
      {
        range: new vscode.Range(end, end),
        hoverMessage: hover(result.repoRoot, blamed, remote, message),
        renderOptions: { after: { contentText: inlineText(blamed.commit, dateFormat) } },
      },
    ]);
  }

  private renderGutter(
    editor: vscode.TextEditor,
    repoRoot: string,
    lines: LineBlame[],
    remote: RemoteInfo | undefined,
  ): void {
    if (!this.fileBlameEnabled) {
      editor.setDecorations(gutterDecoration, []);
      return;
    }
    const decorations: vscode.DecorationOptions[] = [];
    let prevSha: string | undefined;
    const lineCount = editor.document.lineCount;
    for (let i = 0; i < Math.min(lines.length, lineCount); i++) {
      const l = lines[i];
      if (!l) {
        continue;
      }
      // Only label the first line of each consecutive run of the same commit.
      const text = l.commit.sha === prevSha ? '' : gutterText(l.commit);
      prevSha = l.commit.sha;
      const start = new vscode.Position(i, 0);
      decorations.push({
        range: new vscode.Range(start, start),
        hoverMessage: hover(repoRoot, l, remote),
        renderOptions: { before: { contentText: nbsp(text) || '\u00a0' } },
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
