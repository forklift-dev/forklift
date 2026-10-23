import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UNCOMMITTED } from '../../shared/fileHistory';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { FileHistory } from './fileHistory';

let root: string;
const env = { ...process.env, GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (author: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, env: { ...env, GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@x` }, stdio: 'pipe' }).toString().trim();
const history = new FileHistory(new GitCli(directRunner(env)));

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-filehistory-')));
  sh('Ada', 'init', '-q', '--initial-branch=main');
  writeFileSync(join(root, 'old name.txt'), 'one\ntwo\nthree\n');
  writeFileSync(join(root, 'other.txt'), 'x\n');
  sh('Ada', 'add', '.');
  sh('Ada', 'commit', '-qm', 'Create');
  writeFileSync(join(root, 'old name.txt'), 'one\nTWO\nthree\n');
  sh('Grace', 'commit', '-qam', 'Shout two');
  mkdirSync(join(root, 'dir'));
  sh('Grace', 'mv', 'old name.txt', 'dir/new*name.txt');
  sh('Grace', 'commit', '-qm', 'Move');
  writeFileSync(join(root, 'dir/new*name.txt'), 'one\nTWO\nthree\nfour\n');
  sh('Linus', 'commit', '-qam', 'Add four');
  writeFileSync(join(root, 'other.txt'), 'y\n');
  sh('Linus', 'commit', '-qam', 'Unrelated');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('FileHistory', () => {
  it('follows the file through a rename, literal paths, newest first', async () => {
    const entries = await history.log(root, 'dir/new*name.txt');
    expect(entries.map((e) => [e.subject, e.status, e.path, e.oldPath ?? null])).toEqual([
      ['Add four', 'modified', 'dir/new*name.txt', null],
      ['Move', 'renamed', 'dir/new*name.txt', 'old name.txt'],
      ['Shout two', 'modified', 'old name.txt', null],
      ['Create', 'added', 'old name.txt', null],
    ]);
    expect(entries[0]).toMatchObject({ authorName: 'Linus', authorEmail: 'linus@x' });
  });

  it('blames each line, with uncommitted lines in the working tree', async () => {
    writeFileSync(join(root, 'dir/new*name.txt'), 'one\nTWO\nthree\nfour\nfive (not committed)\n');
    const blame = await history.blame(root, 'dir/new*name.txt', null);
    expect(blame.text).toBe('one\nTWO\nthree\nfour\nfive (not committed)');
    const author = (line: number) => {
      const hunk = blame.hunks.find((h) => line >= h.start && line < h.start + h.count)!;
      return hunk.sha === UNCOMMITTED ? 'uncommitted' : blame.commits[hunk.sha]!.authorName;
    };
    expect([1, 2, 3, 4, 5].map(author)).toEqual(['Ada', 'Grace', 'Ada', 'Linus', 'uncommitted']);
    expect(blame.hunks.map((h) => h.count).reduce((a, b) => a + b)).toBe(5);
    const old = await history.blame(root, 'old name.txt', sh('Ada', 'rev-parse', 'HEAD~3'));
    expect(old.text).toBe('one\nTWO\nthree');
    expect(Object.values(old.commits).map((c) => c.summary).sort()).toEqual(['Create', 'Shout two']);
  });

  it('blames a 10 000 line file quickly', async () => {
    writeFileSync(join(root, 'big.txt'), Array.from({ length: 10_000 }, (_, i) => `line ${i}`).join('\n') + '\n');
    sh('Ada', 'add', '.');
    sh('Ada', 'commit', '-qm', 'Big');
    const started = Date.now();
    const blame = await history.blame(root, 'big.txt', null);
    expect(blame.hunks).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
