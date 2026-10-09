import { execFile } from 'child_process';
import * as path from 'path';

export const UNCOMMITTED_SHA = '0000000000000000000000000000000000000000';

export interface CommitInfo {
  sha: string;
  author: string;
  authorMail: string;
  /** Unix seconds. */
  authorTime: number;
  summary: string;
  uncommitted: boolean;
}

/** Blame for a file: one entry per line (index = 0-based line number). */
export type FileBlame = CommitInfo[];

function git(args: string[], cwd: string, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

/** Returns the repository root containing `file`, or undefined if not in a git repo. */
export async function getRepoRoot(file: string): Promise<string | undefined> {
  try {
    return (await git(['rev-parse', '--show-toplevel'], path.dirname(file))).trim();
  } catch {
    return undefined;
  }
}

/**
 * Blames `file`. When `contents` is given (unsaved buffer), it is blamed in place of
 * the on-disk file so that line numbers match the editor.
 * Rejects if the file is untracked or not in a repo.
 */
export async function blame(file: string, contents?: string): Promise<FileBlame> {
  const args = ['blame', '--porcelain'];
  if (contents !== undefined) {
    args.push('--contents', '-');
  }
  args.push('--', path.basename(file));
  const out = await git(args, path.dirname(file), contents);
  return parsePorcelain(out);
}

export function parsePorcelain(out: string): FileBlame {
  const commits = new Map<string, CommitInfo>();
  const result: FileBlame = [];
  let current: CommitInfo | undefined;
  let finalLine = 0;

  for (const line of out.split('\n')) {
    if (line.startsWith('\t')) {
      // Content line terminates a record.
      if (current) {
        result[finalLine - 1] = current;
      }
      current = undefined;
      continue;
    }
    if (!current) {
      const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
      if (!m) {
        continue;
      }
      const sha = m[1];
      finalLine = Number(m[2]);
      current = commits.get(sha);
      if (!current) {
        current = {
          sha,
          author: '',
          authorMail: '',
          authorTime: 0,
          summary: '',
          uncommitted: sha === UNCOMMITTED_SHA,
        };
        commits.set(sha, current);
      }
      continue;
    }
    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);
    switch (key) {
      case 'author':
        current.author = value;
        break;
      case 'author-mail':
        current.authorMail = value.replace(/^<|>$/g, '');
        break;
      case 'author-time':
        current.authorTime = Number(value);
        break;
      case 'summary':
        current.summary = value;
        break;
    }
  }
  return result;
}

const messageCache = new Map<string, Promise<string>>();

/** Full commit message for `sha`, cached. */
export function commitMessage(repoRoot: string, sha: string): Promise<string> {
  let msg = messageCache.get(sha);
  if (!msg) {
    msg = git(['show', '-s', '--format=%B', sha], repoRoot).then((s) => s.trim());
    msg.catch(() => messageCache.delete(sha));
    messageCache.set(sha, msg);
  }
  return msg;
}
