import { execFile } from 'child_process';
import * as fs from 'fs';
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

export interface LineBlame {
  commit: CommitInfo;
  /** Path of the file at `commit.sha`, relative to the repo root. */
  filename: string;
  /** 1-based line number in the file at `commit.sha`. */
  origLine: number;
  /** The file as it was just before `commit.sha`; absent for the commit that created it. */
  previous?: { sha: string; filename: string };
}

/** Blame for a file: one entry per line (index = 0-based line number). */
export type FileBlame = LineBlame[];

/** Ignore whitespace changes and follow lines moved or copied within/between files. */
const BLAME_FLAGS = ['blame', '--porcelain', '-w', '-M', '-C'];

export const IGNORE_REVS_FILE = '.git-blame-ignore-revs';

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

function ignoreRevsArgs(repoRoot: string): string[] {
  const file = path.join(repoRoot, IGNORE_REVS_FILE);
  return fs.existsSync(file) ? ['--ignore-revs-file', file] : [];
}

/**
 * Blames the working-tree `file`. When `contents` is given (unsaved buffer), it is
 * blamed in place of the on-disk file so that line numbers match the editor.
 * Rejects if the file is untracked.
 */
export async function blame(repoRoot: string, file: string, contents?: string): Promise<FileBlame> {
  const args = [...BLAME_FLAGS, ...ignoreRevsArgs(repoRoot)];
  if (contents !== undefined) {
    args.push('--contents', '-');
  }
  args.push('--', path.basename(file));
  return parsePorcelain(await git(args, path.dirname(file), contents));
}

/** Blames `relPath` (relative to the repo root) as of commit `rev`. */
export async function blameRevision(
  repoRoot: string,
  rev: string,
  relPath: string,
): Promise<FileBlame> {
  const args = [...BLAME_FLAGS, ...ignoreRevsArgs(repoRoot), rev, '--', relPath];
  return parsePorcelain(await git(args, repoRoot));
}

/** Contents of `relPath` at commit `rev`. */
export function showFile(repoRoot: string, rev: string, relPath: string): Promise<string> {
  return git(['show', `${rev}:${relPath}`], repoRoot);
}

export function parsePorcelain(out: string): FileBlame {
  const commits = new Map<string, CommitInfo>();
  const result: FileBlame = [];
  // Per-group state: `filename`/`previous` are emitted once for each run of lines.
  let commit: CommitInfo | undefined;
  let origLine = 0;
  let finalLine = 0;
  let filename = '';
  let previous: LineBlame['previous'];
  let inHeader = false;

  for (const line of out.split('\n')) {
    if (line.startsWith('\t')) {
      // Content line terminates a record.
      if (commit) {
        result[finalLine - 1] = { commit, filename, origLine, previous };
      }
      inHeader = false;
      continue;
    }
    if (!inHeader) {
      const m = /^([0-9a-f]{40}) (\d+) (\d+)( \d+)?/.exec(line);
      if (!m) {
        continue;
      }
      inHeader = true;
      const sha = m[1];
      origLine = Number(m[2]);
      finalLine = Number(m[3]);
      if (m[4] || commit?.sha !== sha) {
        // Start of a new group.
        filename = '';
        previous = undefined;
      }
      commit = commits.get(sha);
      if (!commit) {
        commit = {
          sha,
          author: '',
          authorMail: '',
          authorTime: 0,
          summary: '',
          uncommitted: sha === UNCOMMITTED_SHA,
        };
        commits.set(sha, commit);
      }
      continue;
    }
    if (!commit) {
      continue;
    }
    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);
    switch (key) {
      case 'author':
        commit.author = value;
        break;
      case 'author-mail':
        commit.authorMail = value.replace(/^<|>$/g, '');
        break;
      case 'author-time':
        commit.authorTime = Number(value);
        break;
      case 'summary':
        commit.summary = value;
        break;
      case 'filename':
        filename = value;
        break;
      case 'previous': {
        const sp = value.indexOf(' ');
        previous = { sha: value.slice(0, sp), filename: value.slice(sp + 1) };
        break;
      }
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

export interface RemoteInfo {
  /** e.g. https://github.com/owner/repo */
  baseUrl: string;
  /** Display name: GitHub, GitLab, Bitbucket, or the host. */
  name: string;
}

/** Converts a git remote URL (ssh, scp-like or https) into a web URL. */
export function parseRemoteUrl(remote: string): RemoteInfo | undefined {
  let host: string;
  let repoPath: string;
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(remote);
  if (scp && !/^[a-z+]+:\/\//i.test(remote)) {
    [, host, repoPath] = scp;
  } else {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      return undefined;
    }
    if (!/^(https?|ssh|git):$/.test(url.protocol)) {
      return undefined;
    }
    host = url.hostname;
    repoPath = url.pathname;
  }
  repoPath = repoPath.replace(/^\/+/, '').replace(/\.git\/?$/, '').replace(/\/+$/, '');
  if (!host || !repoPath) {
    return undefined;
  }
  const name = /github/i.test(host)
    ? 'GitHub'
    : /gitlab/i.test(host)
      ? 'GitLab'
      : /bitbucket/i.test(host)
        ? 'Bitbucket'
        : host;
  return { baseUrl: `https://${host}/${repoPath}`, name };
}

export function commitWebUrl(remote: RemoteInfo, sha: string): string {
  switch (remote.name) {
    case 'GitLab':
      return `${remote.baseUrl}/-/commit/${sha}`;
    case 'Bitbucket':
      return `${remote.baseUrl}/commits/${sha}`;
    default:
      return `${remote.baseUrl}/commit/${sha}`;
  }
}

const remoteCache = new Map<string, Promise<RemoteInfo | undefined>>();

/** Web info for the `origin` remote (or the first remote), cached per repo. */
export function getRemote(repoRoot: string): Promise<RemoteInfo | undefined> {
  let remote = remoteCache.get(repoRoot);
  if (!remote) {
    remote = (async () => {
      const names = (await git(['remote'], repoRoot)).split('\n').filter(Boolean);
      const name = names.includes('origin') ? 'origin' : names[0];
      if (!name) {
        return undefined;
      }
      return parseRemoteUrl((await git(['remote', 'get-url', name], repoRoot)).trim());
    })().catch(() => undefined);
    remoteCache.set(repoRoot, remote);
  }
  return remote;
}
