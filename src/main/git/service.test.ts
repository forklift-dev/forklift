import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitCli } from './cli';
import { directRunner } from '../process/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HistoryService } from '../history/service';
import { createGitService } from './service';

// Fixtures are built with the git CLI so the test checks nodegit against git's own view of the repo.
function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
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
  }).toString();
}

describe('GitService', () => {
  let root: string;
  const service = createGitService();
  const history = new HistoryService(new GitCli(directRunner()));

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
    expect(data.refs).toEqual({});
    expect(await history.page(root, data.historyVersion, 0, 50)).toMatchObject({ rows: [], loaded: 0, complete: true });
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
    const { rows, complete, version } = await history.page(root, data.historyVersion, 0, 50);
    expect(complete).toBe(true);
    expect(version).toBe(data.historyVersion);
    expect(data.branch.oid).toBe(rows[0]?.hash);

    expect(rows.map((c) => c.subject)).toEqual(['Second commit', 'First commit']);
    expect(rows[0]).toMatchObject({
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      authorTime: Date.parse('2026-01-02T03:04:05Z') / 1000,
    });
    expect(rows[0]?.parents).toEqual([rows[1]?.hash]);
    expect(data.refs[rows[0]!.hash]).toEqual(['HEAD -> main']);
    expect(data.refs[rows[1]!.hash]?.sort()).toEqual(['feature', 'tag: v1']);

    const byPath = Object.fromEntries(data.changes.map((c) => [c.path, c]));
    expect(byPath['a.txt']).toMatchObject({ kind: 'modified', staged: false, unstaged: true });
    expect(byPath['new.txt']).toMatchObject({ kind: 'renamed', origPath: 'old.txt', staged: true });
    expect(byPath['untracked.txt']).toMatchObject({ kind: 'untracked', staged: false, unstaged: true });
  });

  it('leaves out files outside a sparse checkout, as git status does', async () => {
    mkdirSync(join(root, 'in'));
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'in', 'a.txt'), 'a\n');
    writeFileSync(join(root, 'out', 'b.txt'), 'b\n');
    sh(root, 'add', '.');
    sh(root, 'commit', '-m', 'First commit');
    sh(root, 'sparse-checkout', 'set', 'in');
    expect(existsSync(join(root, 'out', 'b.txt'))).toBe(false);
    writeFileSync(join(root, 'in', 'a.txt'), 'changed\n');
    const changes = (await service.read(root)).changes.map((change) => change.path);
    expect(changes).toEqual(['in/a.txt']);
    expect(sh(root, 'status', '--porcelain')).toBe(' M in/a.txt\n');
  });

  it('leaves out local changes of files marked skip-worktree', async () => {
    writeFileSync(join(root, 'local.txt'), 'shared\n');
    writeFileSync(join(root, 'a.txt'), 'a\n');
    sh(root, 'add', '.');
    sh(root, 'commit', '-m', 'First commit');
    sh(root, 'update-index', '--skip-worktree', 'local.txt');
    writeFileSync(join(root, 'local.txt'), 'my own settings\n');
    writeFileSync(join(root, 'a.txt'), 'changed\n');
    expect(sh(root, 'status', '--porcelain')).toBe(' M a.txt\n');
    expect((await service.read(root)).changes.map((change) => change.path)).toEqual(['a.txt']);
  });

  it('tells whether git has a commit-graph (one file or a chain)', async () => {
    writeFileSync(join(root, 'a.txt'), 'a\n');
    sh(root, 'add', '.');
    sh(root, 'commit', '-m', 'First commit');
    expect((await service.read(root)).commitGraph).toBe(false);
    sh(root, 'commit-graph', 'write', '--reachable');
    expect((await service.read(root)).commitGraph).toBe(true);
    rmSync(join(root, '.git/objects/info/commit-graph'));
    sh(root, 'commit-graph', 'write', '--reachable', '--split');
    expect((await service.read(root)).commitGraph).toBe(true);
  });

  it('reports merge conflicts as unstaged changes', async () => {
    writeFileSync(join(root, 'c.txt'), 'base\n');
    sh(root, 'add', '.');
    sh(root, 'commit', '-m', 'base');
    sh(root, 'checkout', '-b', 'theirs');
    writeFileSync(join(root, 'c.txt'), 'theirs\n');
    sh(root, 'commit', '-am', 'theirs');
    sh(root, 'checkout', 'main');
    writeFileSync(join(root, 'c.txt'), 'ours\n');
    sh(root, 'commit', '-am', 'ours');
    expect(() => sh(root, 'merge', 'theirs')).toThrow(); // exits 1 on conflict

    const { changes } = await service.read(root);
    expect(changes).toEqual([{ path: 'c.txt', kind: 'conflicted', staged: false, unstaged: true }]);
  });
});

describe('GitService refs', () => {
  it('lists a remote branch once even with refs/remotes/<remote>/HEAD', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-test-')));
    try {
      sh(root, 'init', '--initial-branch=main');
      writeFileSync(join(root, 'a.txt'), 'a\n');
      sh(root, 'add', '.');
      sh(root, 'commit', '-m', 'a');
      sh(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      sh(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
      const data = await createGitService().read(root);
      expect(data.remoteBranches.map((b) => b.name)).toEqual(['origin/main']);
      expect(Object.values(data.refs).flat().filter((label) => label === 'origin/main')).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
