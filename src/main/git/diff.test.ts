import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_DIFF_FILE_BYTES } from '../../shared/diff';
import { createGitService } from './service';

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Ada',
  GIT_AUTHOR_EMAIL: 'ada@example.com',
  GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z',
  GIT_COMMITTER_NAME: 'Bob',
  GIT_COMMITTER_EMAIL: 'bob@example.com',
  GIT_COMMITTER_DATE: '2026-01-03T03:04:05Z',
};

describe('commit details and file diffs', () => {
  const service = createGitService();
  let root: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env }).toString().trim();
  const write = (path: string, content: string | Buffer) => writeFileSync(join(root, path), content);
  const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-diff-')));
    git('init', '--initial-branch=main');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('describes a root commit with every file added', async () => {
    write('a.txt', 'one\ntwo\n');
    git('add', '.');
    git('commit', '-m', 'Initial\n\nLonger body.');
    const details = await service.commitDetails(root, git('rev-parse', 'HEAD'));

    expect(details).toMatchObject({
      parents: [],
      author: { name: 'Ada', email: 'ada@example.com', time: Date.parse('2026-01-02T03:04:05Z') / 1000 },
      committer: { name: 'Bob', email: 'bob@example.com' },
      message: 'Initial\n\nLonger body.\n',
      statsOmitted: false,
      files: [{ path: 'a.txt', status: 'added', additions: 2, deletions: 0, binary: false }],
    });

    const diff = await service.fileDiff(root, { kind: 'commit', sha: details.hash, path: 'a.txt' });
    expect(diff.original.exists).toBe(false);
    expect(diff.modified).toMatchObject({ exists: true, text: 'one\ntwo\n', binary: false });
  });

  it('lists modified, added, deleted and renamed files with line counts', async () => {
    write('mod.txt', lines(10));
    write('gone.txt', 'bye\n');
    write('old-name.txt', lines(20, 'stable'));
    git('add', '.');
    git('commit', '-m', 'base');

    write('mod.txt', lines(10).replace('line 3\n', 'LINE THREE\n').replace('line 7\n', ''));
    write('new.txt', 'hello\n');
    unlinkSync(join(root, 'gone.txt'));
    git('mv', 'old-name.txt', 'new-name.txt');
    git('add', '-A');
    git('commit', '-m', 'changes');

    const { files } = await service.commitDetails(root, git('rev-parse', 'HEAD'));
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath['mod.txt']).toMatchObject({ status: 'modified', additions: 1, deletions: 2 });
    expect(byPath['new.txt']).toMatchObject({ status: 'added', additions: 1, deletions: 0 });
    expect(byPath['gone.txt']).toMatchObject({ status: 'deleted', additions: 0, deletions: 1 });
    expect(byPath['new-name.txt']).toMatchObject({ status: 'renamed', oldPath: 'old-name.txt', additions: 0, deletions: 0 });

    const renamed = await service.fileDiff(root, { kind: 'commit', sha: git('rev-parse', 'HEAD'), path: 'new-name.txt', oldPath: 'old-name.txt' });
    expect(renamed.original.text).toBe(lines(20, 'stable'));
    expect(renamed.modified.text).toBe(lines(20, 'stable'));

    const deleted = await service.fileDiff(root, { kind: 'commit', sha: git('rev-parse', 'HEAD'), path: 'gone.txt' });
    expect(deleted.original.text).toBe('bye\n');
    expect(deleted.modified.exists).toBe(false);
  });

  it('shows a merge commit against its first parent', async () => {
    write('f.txt', 'base\n');
    git('add', '.');
    git('commit', '-m', 'base');
    git('checkout', '-b', 'side');
    write('side.txt', 'from side\n');
    git('add', '.');
    git('commit', '-m', 'side');
    git('checkout', 'main');
    write('main.txt', 'from main\n');
    git('add', '.');
    git('commit', '-m', 'main');
    git('merge', '--no-ff', 'side', '-m', 'merge');

    const details = await service.commitDetails(root, git('rev-parse', 'HEAD'));
    expect(details.parents).toHaveLength(2);
    expect(details.files.map((f) => f.path)).toEqual(['side.txt']);
  });

  it('compares divergent trees directly and from their common ancestor', async () => {
    write('shared.txt', 'base\n');
    git('add', '.');
    git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'side');
    write('shared.txt', 'side\n');
    write('side.txt', 'side only\n');
    git('add', '.');
    git('commit', '-m', 'side');
    const side = git('rev-parse', 'HEAD');
    git('checkout', 'main');
    write('shared.txt', 'main\n');
    write('main.txt', 'main only\n');
    git('add', '.');
    git('commit', '-m', 'main');
    const main = git('rev-parse', 'HEAD');

    const direct = await service.comparisonDetails(root, main, side, main, 'direct');
    expect(direct.files.map((file) => [file.path, file.status])).toEqual([
      ['main.txt', 'deleted'], ['shared.txt', 'modified'], ['side.txt', 'added'],
    ]);
    const fromBase = await service.comparisonDetails(root, main, side, base, 'merge-base');
    expect(fromBase.files.map((file) => [file.path, file.status])).toEqual([
      ['shared.txt', 'modified'], ['side.txt', 'added'],
    ]);
    const file = await service.fileDiff(root, { kind: 'comparison', base, head: side, path: 'shared.txt' });
    expect([file.original.text, file.modified.text]).toEqual(['base\n', 'side\n']);
  });

  it('flags binary files and does not send their content', async () => {
    write('img.bin', Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
    git('add', '.');
    git('commit', '-m', 'binary');
    const sha = git('rev-parse', 'HEAD');
    expect((await service.commitDetails(root, sha)).files[0]).toMatchObject({ path: 'img.bin', binary: true });
    const diff = await service.fileDiff(root, { kind: 'commit', sha, path: 'img.bin' });
    expect(diff.modified).toMatchObject({ exists: true, binary: true, text: null, size: 5 });
  });

  it('compares index with working tree, and HEAD with index', async () => {
    write('a.txt', 'committed\n');
    git('add', '.');
    git('commit', '-m', 'base');
    write('a.txt', 'staged\n');
    git('add', 'a.txt');
    write('a.txt', 'working\n');
    write('untracked.txt', 'new\n');

    const unstaged = await service.fileDiff(root, { kind: 'worktree', path: 'a.txt', staged: false });
    expect([unstaged.original.text, unstaged.modified.text]).toEqual(['staged\n', 'working\n']);
    const staged = await service.fileDiff(root, { kind: 'worktree', path: 'a.txt', staged: true });
    expect([staged.original.text, staged.modified.text]).toEqual(['committed\n', 'staged\n']);

    const untracked = await service.fileDiff(root, { kind: 'worktree', path: 'untracked.txt', staged: false });
    expect(untracked.original.exists).toBe(false);
    expect(untracked.modified.text).toBe('new\n');

    unlinkSync(join(root, 'a.txt'));
    const deleted = await service.fileDiff(root, { kind: 'worktree', path: 'a.txt', staged: false });
    expect(deleted.original.text).toBe('staged\n');
    expect(deleted.modified.exists).toBe(false);
  });

  it('handles staged files in a repository without commits', async () => {
    write('first.txt', 'first\n');
    git('add', '.');
    const diff = await service.fileDiff(root, { kind: 'worktree', path: 'first.txt', staged: true });
    expect(diff.original.exists).toBe(false);
    expect(diff.modified.text).toBe('first\n');
  });

  it('does not load versions over the size limit', async () => {
    write('big.txt', 'x'.repeat(MAX_DIFF_FILE_BYTES + 1));
    const diff = await service.fileDiff(root, { kind: 'worktree', path: 'big.txt', staged: false });
    expect(diff.modified).toMatchObject({ exists: true, tooLarge: true, text: null, size: MAX_DIFF_FILE_BYTES + 1 });
  });

  it.skipIf(process.platform === 'win32')('compares a symlink by its target, as git stores it', async () => {
    write('target.txt', 'content\n');
    symlinkSync('target.txt', join(root, 'link'));
    const diff = await service.fileDiff(root, { kind: 'worktree', path: 'link', staged: false });
    expect(diff.modified.text).toBe('target.txt');
  });
});
