import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { blame, commitMessage, getRepoRoot } from '../git';

function run(cwd: string, args: string[], author: string): void {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@example.com`,
      GIT_COMMITTER_NAME: author,
      GIT_COMMITTER_EMAIL: `${author.toLowerCase()}@example.com`,
    },
  });
}

describe('git blame', () => {
  let repo: string;
  let file: string;

  before(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-blame-test-')));
    run(repo, ['init', '-q'], 'Alice');
    file = path.join(repo, 'a.txt');
    fs.writeFileSync(file, 'one\ntwo\n');
    run(repo, ['add', '.'], 'Alice');
    run(repo, ['commit', '-q', '-m', 'First commit\n\nWith a body.'], 'Alice');
    fs.writeFileSync(file, 'one\ntwo\nthree\n');
    run(repo, ['commit', '-q', '-am', 'Add three'], 'Bob');
  });

  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('finds the repo root', async () => {
    assert.strictEqual(await getRepoRoot(file), repo);
    assert.strictEqual(await getRepoRoot(path.join(os.tmpdir(), 'x.txt')), undefined);
  });

  it('attributes each line to its commit', async () => {
    const lines = await blame(file);
    assert.strictEqual(lines.length, 3);
    assert.deepStrictEqual(
      lines.map((l) => [l.author, l.summary]),
      [
        ['Alice', 'First commit'],
        ['Alice', 'First commit'],
        ['Bob', 'Add three'],
      ],
    );
    assert.strictEqual(lines[0].authorMail, 'alice@example.com');
    assert.ok(lines[0].authorTime > 0);
    assert.strictEqual(lines[0], lines[1]);
    assert.ok(!lines[2].uncommitted);
  });

  it('blames unsaved buffer contents', async () => {
    const lines = await blame(file, 'zero\none\ntwo\nthree\n');
    assert.strictEqual(lines.length, 4);
    assert.ok(lines[0].uncommitted);
    assert.strictEqual(lines[1].author, 'Alice');
    assert.strictEqual(lines[3].author, 'Bob');
  });

  it('marks uncommitted on-disk changes', async () => {
    fs.writeFileSync(file, 'one\nTWO\nthree\n');
    try {
      const lines = await blame(file);
      assert.ok(lines[1].uncommitted);
      assert.strictEqual(lines[2].author, 'Bob');
    } finally {
      run(repo, ['checkout', '--', 'a.txt'], 'Alice');
    }
  });

  it('rejects untracked files', async () => {
    const untracked = path.join(repo, 'new.txt');
    fs.writeFileSync(untracked, 'x\n');
    await assert.rejects(blame(untracked));
  });

  it('reads the full commit message', async () => {
    const [first] = await blame(file);
    assert.strictEqual(await commitMessage(repo, first.sha), 'First commit\n\nWith a body.');
  });
});
