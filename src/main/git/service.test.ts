import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitService } from './service';

// Fixtures are built with the git CLI so the test checks nodegit against git's own view of the repo.
function sh(cwd: string, ...args: string[]) {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Ada',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z',
      GIT_COMMITTER_NAME: 'Ada',
      GIT_COMMITTER_EMAIL: 'ada@example.com',
      GIT_COMMITTER_DATE: '2026-01-02T03:04:05Z',
    },
  });
}

describe('GitService', () => {
  let root: string;
  const service = createGitService();

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-test-')));
    sh(root, 'init', '--initial-branch=main');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads an empty repository', async () => {
    const data = await service.read(root);
    expect(data.branch).toEqual({ head: 'main', oid: null, upstream: null, ahead: 0, behind: 0 });
    expect(data.commits).toEqual([]);
  });

  it('resolves the root from a nested directory', async () => {
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    expect(await service.resolveRoot(join(root, 'a', 'b'))).toBe(root);
  });

  it('rejects a directory outside any repository', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'forklift-norepo-'));
    try {
      await expect(service.resolveRoot(outside)).rejects.toThrow();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('reads commits, decorations and working tree changes', async () => {
    writeFileSync(join(root, 'a.txt'), 'one\n');
    writeFileSync(join(root, 'old.txt'), 'rename me\n');
    sh(root, 'add', '.');
    sh(root, 'commit', '-m', 'First commit');
    sh(root, 'tag', '-a', 'v1', '-m', 'Version 1');
    sh(root, 'branch', 'feature');

    writeFileSync(join(root, 'a.txt'), 'two\n');
    sh(root, 'commit', '-am', 'Second commit');

    writeFileSync(join(root, 'a.txt'), 'three\n'); // unstaged modification
    sh(root, 'mv', 'old.txt', 'new.txt'); // staged rename
    writeFileSync(join(root, 'untracked.txt'), 'new\n');

    const data = await service.read(root);

    expect(data.name).toBe(root.split(/[\\/]/).pop());
    expect(data.branch.head).toBe('main');
    expect(data.branch.oid).toBe(data.commits[0]?.hash);

    expect(data.commits.map((c) => c.subject)).toEqual(['Second commit', 'First commit']);
    expect(data.commits[0]).toMatchObject({
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      authorTime: Date.parse('2026-01-02T03:04:05Z') / 1000,
      refs: ['HEAD -> main'],
    });
    expect(data.commits[0]?.parents).toEqual([data.commits[1]?.hash]);
    expect(data.commits[1]?.refs.sort()).toEqual(['feature', 'tag: v1']);

    const byPath = Object.fromEntries(data.changes.map((c) => [c.path, c]));
    expect(byPath['a.txt']).toMatchObject({ kind: 'modified', staged: false, unstaged: true });
    expect(byPath['new.txt']).toMatchObject({ kind: 'renamed', origPath: 'old.txt', staged: true });
    expect(byPath['untracked.txt']).toMatchObject({ kind: 'untracked', staged: false, unstaged: true });
  });
});
