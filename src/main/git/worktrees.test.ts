import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { parseWorktreeList, WorktreeService } from './worktrees';

let dir: string;
let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();
const service = new WorktreeService(new GitCli(directRunner(env)));

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-worktrees-')));
  root = join(dir, 'repo');
  sh(dir, 'init', '-q', '--initial-branch=main', root);
  writeFileSync(join(root, 'a.txt'), 'a\n');
  sh(root, 'add', '.');
  sh(root, 'commit', '-qm', 'init');
  sh(root, 'branch', 'topic');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parseWorktreeList', () => {
  it('reads branches, detached and bare trees, locks and prunable ones', () => {
    const output = 'worktree /r\nbare\n\nworktree /w1\nHEAD abc\nbranch refs/heads/feature/x\n\nworktree /w2\nHEAD def\ndetached\nlocked on usb\nprunable gitdir file points to non-existent location\n\n';
    expect(parseWorktreeList(output, '/w1')).toEqual([
      { path: '/r', head: null, branch: null, bare: true, main: true, current: false, locked: null, prunable: false },
      { path: '/w1', head: 'abc', branch: 'feature/x', bare: false, main: false, current: true, locked: null, prunable: false },
      { path: '/w2', head: 'def', branch: null, bare: false, main: false, current: false, locked: 'on usb', prunable: true },
    ]);
  });
});

describe('WorktreeService', () => {
  it('adds working trees for a branch or a new branch, and lists them', async () => {
    const topic = join(dir, 'repo-topic');
    const fresh = join(dir, 'repo-fresh');
    await service.add(root, { path: topic, branch: 'topic', newBranch: null });
    await service.add(root, { path: fresh, branch: null, newBranch: 'fresh' });
    const list = await service.list(root);
    expect(list.map((t) => [t.path, t.branch, t.main, t.current])).toEqual([
      [root, 'main', true, true],
      // git lists linked trees by path.
      [fresh, 'fresh', false, false],
      [topic, 'topic', false, false],
    ]);
    expect(existsSync(join(topic, 'a.txt'))).toBe(true);
    // Seen from a linked tree, that one is current.
    expect((await service.list(topic)).find((t) => t.current)?.path).toBe(topic);
  });

  it('refuses a used folder, a missing parent and bad branch names', async () => {
    mkdirSync(join(dir, 'busy'));
    writeFileSync(join(dir, 'busy', 'x'), '');
    await expect(service.add(root, { path: join(dir, 'busy'), branch: 'topic', newBranch: null })).rejects.toThrow(/not empty/);
    await expect(service.add(root, { path: join(dir, 'no', 'such'), branch: 'topic', newBranch: null })).rejects.toThrow(/not an existing folder/);
    await expect(service.add(root, { path: 'relative', branch: 'topic', newBranch: null })).rejects.toThrow(/full path/);
    await expect(service.add(root, { path: join(dir, 'x'), branch: null, newBranch: 'bad..name' })).rejects.toThrow(/not a valid branch name/);
    await expect(service.add(root, { path: join(dir, 'x'), branch: '--evil', newBranch: null })).rejects.toThrow(/Choose a branch/);
    // git itself refuses a branch checked out elsewhere.
    await expect(service.add(root, { path: join(dir, 'x'), branch: 'main', newBranch: null })).rejects.toThrow(/already (checked out|used by worktree)/);
  });

  it('locks, removes (forced with changes) and prunes', async () => {
    const topic = join(dir, 'repo-topic');
    await service.add(root, { path: topic, branch: 'topic', newBranch: null });
    await service.lock(root, topic, true);
    expect((await service.list(root))[1]!.locked).toBe('');
    await expect(service.remove(root, topic, false)).rejects.toThrow(/locked/);
    await service.lock(root, topic, false);
    writeFileSync(join(topic, 'a.txt'), 'changed\n');
    await expect(service.remove(root, topic, false)).rejects.toThrow(/modified or untracked|contains modified/);
    await service.remove(root, topic, true);
    expect(existsSync(topic)).toBe(false);
    await expect(service.remove(root, root, true)).rejects.toThrow(/main working tree/);

    const gone = join(dir, 'gone');
    await service.add(root, { path: gone, branch: null, newBranch: 'gone' });
    rmSync(gone, { recursive: true });
    expect((await service.list(root)).find((t) => t.path === gone)?.prunable).toBe(true);
    await service.prune(root);
    expect((await service.list(root)).map((t) => t.path)).toEqual([root]);
  });
});
