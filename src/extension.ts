import * as vscode from 'vscode';
import { BlameCache } from './blameCache';
import { BlameDecorator } from './decorations';

export function activate(context: vscode.ExtensionContext): void {
  const cache = new BlameCache();
  const decorator = new BlameDecorator(cache);

  // Commits, checkouts, resets, and staging all touch HEAD or the index.
  const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/{HEAD,index}');
  const onGitChange = () => {
    cache.clear();
    decorator.scheduleRender(300);
  };

  context.subscriptions.push(
    decorator,
    gitWatcher,
    gitWatcher.onDidChange(onGitChange),
    gitWatcher.onDidCreate(onGitChange),
    vscode.commands.registerCommand('gitBlame.toggleFileBlame', () => {
      decorator.fileBlameEnabled = !decorator.fileBlameEnabled;
      void decorator.render();
    }),
    vscode.commands.registerCommand('gitBlame.toggleInline', async () => {
      const cfg = vscode.workspace.getConfiguration('gitBlame');
      await cfg.update(
        'inlineEnabled',
        !cfg.get<boolean>('inlineEnabled', true),
        vscode.ConfigurationTarget.Global,
      );
    }),
    vscode.window.onDidChangeActiveTextEditor(() => decorator.scheduleRender(0)),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === vscode.window.activeTextEditor) {
        decorator.scheduleRender();
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) {
        decorator.scheduleRender(500);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      cache.delete(doc.uri);
      decorator.scheduleRender(0);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => cache.delete(doc.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gitBlame')) {
        decorator.scheduleRender(0);
      }
    }),
  );

  decorator.scheduleRender(0);
}

export function deactivate(): void {}
