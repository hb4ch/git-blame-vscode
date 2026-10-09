import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  blame,
  blameRevision,
  commitMessage,
  commitWebUrl,
  getRepoRoot,
  IGNORE_REVS_FILE,
  parseRemoteUrl,
  showFile,
} from '../git';

function run(cwd: string, args: string[], author = 'Alice'): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@example.com`,
      GIT_COMMITTER_NAME: author,
      GIT_COMMITTER_EMAIL: `${author.toLowerCase()}@example.com`,
    },
  }).trim();
}

const LONG = [
  'const firstLongLineThatIsEasilyRecognizedByCopyDetection = 1;',
  'const secondLongLineThatIsEasilyRecognizedByCopyDetection = 2;',
  'const thirdLongLineThatIsEasilyRecognizedByCopyDetection = 3;',
];

describe('git blame', () => {
  let repo: string;
  let file: string;
  /** Commit shas by author. */
  const sha: Record<string, string> = {};

  function commit(author: string, message: string, files: Record<string, string>): void {
    for (const [name, contents] of Object.entries(files)) {
      fs.writeFileSync(path.join(repo, name), contents);
    }
    run(repo, ['add', '.'], author);
    run(repo, ['commit', '-q', '-m', message], author);
    sha[author] = run(repo, ['rev-parse', 'HEAD']);
  }

  before(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-blame-test-')));
    run(repo, ['init', '-q']);
    file = path.join(repo, 'a.txt');
    commit('Alice', 'First commit\n\nWith a body.', {
      'a.txt': ['one', 'two', ...LONG, ''].join('\n'),
    });
    commit('Bob', 'Add three', { 'a.txt': ['one', 'two', ...LONG, 'three', ''].join('\n') });
    commit('Carol', 'Reformat', { 'a.txt': ['ONE', 'two', ...LONG, 'three', ''].join('\n') });
    commit('Dave', 'Move long lines to b.txt', {
      'a.txt': 'ONE\ntwo\nthree\n',
      'b.txt': [...LONG, ''].join('\n'),
    });
    commit('Erin', 'Indent', { 'a.txt': 'ONE\n\ttwo\nthree\n' });
  });

  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  afterEach(() => fs.rmSync(path.join(repo, IGNORE_REVS_FILE), { force: true }));

  it('finds the repo root', async () => {
    assert.strictEqual(await getRepoRoot(file), repo);
    assert.strictEqual(await getRepoRoot(path.join(os.tmpdir(), 'x.txt')), undefined);
  });

  it('attributes each line to its commit, ignoring whitespace-only changes', async () => {
    const lines = await blame(repo, file);
    assert.deepStrictEqual(
      lines.map((l) => l.commit.author),
      ['Carol', 'Alice', 'Bob'],
    );
    assert.strictEqual(lines[1].commit.summary, 'First commit');
    assert.strictEqual(lines[1].commit.authorMail, 'alice@example.com');
    assert.ok(lines[1].commit.authorTime > 0);
    assert.strictEqual(lines[1].commit.sha, sha.Alice);
  });

  it('records the file path, original line and previous revision', async () => {
    const lines = await blame(repo, file);
    assert.strictEqual(lines[2].filename, 'a.txt');
    assert.strictEqual(lines[2].origLine, 6);
    assert.deepStrictEqual(lines[2].previous, { sha: sha.Alice, filename: 'a.txt' });
    assert.strictEqual(lines[1].previous, undefined, 'root commit has no previous');
  });

  it('follows lines moved to another file', async () => {
    const lines = await blame(repo, path.join(repo, 'b.txt'));
    assert.deepStrictEqual(
      lines.map((l) => [l.commit.author, l.filename, l.origLine]),
      [
        ['Alice', 'a.txt', 3],
        ['Alice', 'a.txt', 4],
        ['Alice', 'a.txt', 5],
      ],
    );
  });

  it('honors .git-blame-ignore-revs', async () => {
    fs.writeFileSync(path.join(repo, IGNORE_REVS_FILE), `# formatting\n${sha.Carol}\n`);
    const lines = await blame(repo, file);
    assert.deepStrictEqual(
      lines.map((l) => l.commit.author),
      ['Alice', 'Alice', 'Bob'],
    );
  });

  it('blames unsaved buffer contents', async () => {
    const lines = await blame(repo, file, 'zero\nONE\n\ttwo\nthree\n');
    assert.strictEqual(lines.length, 4);
    assert.ok(lines[0].commit.uncommitted);
    assert.strictEqual(lines[1].commit.author, 'Carol');
    assert.strictEqual(lines[3].commit.author, 'Bob');
  });

  it('marks uncommitted on-disk changes', async () => {
    fs.writeFileSync(file, 'ONE\nTWO\nthree\n');
    try {
      const lines = await blame(repo, file);
      assert.ok(lines[1].commit.uncommitted);
      assert.strictEqual(lines[2].commit.author, 'Bob');
    } finally {
      run(repo, ['checkout', '--', 'a.txt']);
    }
  });

  it('rejects untracked files', async () => {
    const untracked = path.join(repo, 'new.txt');
    fs.writeFileSync(untracked, 'x\n');
    try {
      await assert.rejects(blame(repo, untracked));
    } finally {
      fs.rmSync(untracked);
    }
  });

  it('blames and shows a past revision', async () => {
    const lines = await blameRevision(repo, sha.Bob, 'a.txt');
    assert.deepStrictEqual(
      lines.map((l) => l.commit.author),
      ['Alice', 'Alice', 'Alice', 'Alice', 'Alice', 'Bob'],
    );
    assert.strictEqual(await showFile(repo, sha.Alice, 'a.txt'), ['one', 'two', ...LONG, ''].join('\n'));
  });

  it('reads the full commit message', async () => {
    assert.strictEqual(await commitMessage(repo, sha.Alice), 'First commit\n\nWith a body.');
  });
});

describe('remote URLs', () => {
  const cases: [string, string | undefined, string][] = [
    ['git@github.com:hb4ch/git-blame-vscode.git', 'https://github.com/hb4ch/git-blame-vscode', 'GitHub'],
    ['https://github.com/hb4ch/git-blame-vscode.git', 'https://github.com/hb4ch/git-blame-vscode', 'GitHub'],
    ['https://user:pw@github.com/a/b', 'https://github.com/a/b', 'GitHub'],
    ['ssh://git@gitlab.example.com:2222/group/sub/repo.git', 'https://gitlab.example.com/group/sub/repo', 'GitLab'],
    ['git@bitbucket.org:team/repo.git', 'https://bitbucket.org/team/repo', 'Bitbucket'],
    ['https://git.example.org/x/y', 'https://git.example.org/x/y', 'git.example.org'],
    ['/srv/git/repo.git', undefined, ''],
    ['file:///srv/git/repo.git', undefined, ''],
  ];
  for (const [remote, baseUrl, name] of cases) {
    it(`parses ${remote}`, () => {
      const info = parseRemoteUrl(remote);
      assert.strictEqual(info?.baseUrl, baseUrl);
      if (info) {
        assert.strictEqual(info.name, name);
      }
    });
  }

  it('builds host-specific commit URLs', () => {
    assert.strictEqual(
      commitWebUrl({ baseUrl: 'https://gitlab.com/a/b', name: 'GitLab' }, 'abc'),
      'https://gitlab.com/a/b/-/commit/abc',
    );
    assert.strictEqual(
      commitWebUrl({ baseUrl: 'https://bitbucket.org/a/b', name: 'Bitbucket' }, 'abc'),
      'https://bitbucket.org/a/b/commits/abc',
    );
    assert.strictEqual(
      commitWebUrl({ baseUrl: 'https://github.com/a/b', name: 'GitHub' }, 'abc'),
      'https://github.com/a/b/commit/abc',
    );
  });
});
