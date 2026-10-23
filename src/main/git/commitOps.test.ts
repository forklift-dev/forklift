import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { CommitOps } from './commitOps';
import { createGitService } from './service';

let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' }).toString().trim();
const write = (path: string, text: string) => writeFileSync(join(root, path), text);
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const ops = new CommitOps(new GitCli(directRunner(env)));
const git = createGitService();

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-ops-')));
  sh('init', '-q', '--initial-branch=main');
  write('f.txt', 'base\n');
  sh('add', '.');
  sh('commit', '-qm', 'base');
  sh('switch', '-qc', 'feature');
  write('g.txt', 'feature file\n');
  sh('add', '.');
  sh('commit', '-qm', 'add g');
  write('f.txt', 'feature edit\n');
  sh('commit', '-qam', 'edit f');
  sh('switch', '-q', 'main');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('CommitOps', () => {
  it('cherry-picks a commit onto the current branch', async () => {
    const addG = sh('rev-parse', 'feature~1');
    expect(await ops.cherryPick(root, addG)).toBe('done');
    expect(sh('log', '-1', '--format=%s')).toBe('add g');
    expect(read('g.txt')).toBe('feature file\n');
  });

  it('stops on cherry-pick conflicts and leaves the operation for the banner', async () => {
    write('f.txt', 'main edit\n');
    sh('commit', '-qam', 'main edit');
    expect(await ops.cherryPick(root, sh('rev-parse', 'feature'))).toBe('conflicts');
    expect((await git.read(root)).operation).toMatchObject({ kind: 'cherry-pick' });
  });

  it('reverts a commit with git’s message, and a merge relative to its first parent', async () => {
    sh('merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature');
    expect(read('g.txt')).toBe('feature file\n');
    expect(await ops.revert(root, sh('rev-parse', 'HEAD'))).toBe('done');
    expect(sh('log', '-1', '--format=%s')).toBe('Revert "Merge feature"');
    expect(read('f.txt')).toBe('base\n');
  });

  it('refuses cleanly when local changes would be overwritten', async () => {
    write('f.txt', 'uncommitted\n');
    await expect(ops.cherryPick(root, sh('rev-parse', 'feature'))).rejects.toThrow(/local changes|overwritten/);
    expect(read('f.txt')).toBe('uncommitted\n');
    expect((await git.read(root)).operation).toBeNull();
  });

  it('resets soft, mixed and hard', async () => {
    sh('merge', '-q', '--ff-only', 'feature');
    const base = sh('rev-parse', 'HEAD~2');
    await ops.reset(root, base, 'soft');
    expect(sh('diff', '--cached', '--name-only')).toBe('f.txt\ng.txt');
    sh('reset', '-q', '--hard', 'feature');
    await ops.reset(root, base, 'mixed');
    expect(sh('diff', '--cached', '--name-only')).toBe('');
    expect(sh('status', '--porcelain')).toBe('M f.txt\n?? g.txt'); // ' M' (trimmed): unstaged
    await ops.reset(root, base, 'hard');
    expect(sh('status', '--porcelain')).toBe('?? g.txt');
    expect(read('f.txt')).toBe('base\n');
    await expect(ops.reset(root, 'nope', 'hard')).rejects.toThrow('full commit hash');
  });
});

describe('merge and rebase', () => {
  const branchSetup = () => {
    // main gets its own commit, so merging feature is not a fast-forward.
    write('m.txt', 'main\n');
    sh('add', '.');
    sh('commit', '-qm', 'main work');
  };

  it('fast-forwards by default when possible; ff-only refuses otherwise', async () => {
    expect(await ops.merge(root, 'feature', 'default', null)).toBe('done');
    expect(sh('rev-parse', 'HEAD')).toBe(sh('rev-parse', 'feature'));
    sh('reset', '-q', '--hard', 'HEAD~2');
    branchSetup();
    await expect(ops.merge(root, 'feature', 'ff-only', null)).rejects.toThrow(/fast-forward|Not possible/i);
  });

  it('creates a merge commit with no-ff and a custom message', async () => {
    expect(await ops.merge(root, 'feature', 'no-ff', 'Bring in feature; $(echo safe)')).toBe('done');
    expect(sh('log', '-1', '--format=%P').split(' ')).toHaveLength(2);
    expect(sh('log', '-1', '--format=%s')).toBe('Bring in feature; $(echo safe)');
  });

  it('squashes: changes staged with a prepared message, nothing committed', async () => {
    branchSetup();
    const head = sh('rev-parse', 'HEAD');
    expect(await ops.merge(root, 'feature', 'squash', null)).toBe('done');
    expect(sh('rev-parse', 'HEAD')).toBe(head);
    expect(sh('diff', '--cached', '--name-only')).toBe('f.txt\ng.txt');
    expect((await git.read(root)).preparedMessage).toMatch(/^Squashed commit of the following/);
  });

  it('stops a conflicting merge for the banner, carrying uncommitted changes with autostash', async () => {
    write('f.txt', 'main edit\n');
    sh('commit', '-qam', 'main edit');
    write('m.txt', 'uncommitted, unrelated\n');
    expect(await ops.merge(root, 'feature', 'default', null)).toBe('conflicts');
    expect((await git.read(root)).operation).toMatchObject({ kind: 'merge', subject: 'feature' });
    expect((await git.read(root)).preparedMessage).toMatch(/^Merge branch 'feature'/);
  });

  it('rebases onto another branch, and stops on conflicts', async () => {
    branchSetup();
    sh('switch', '-q', 'feature');
    expect(await ops.rebase(root, 'main')).toBe('done');
    expect(sh('log', '--format=%s', '-4')).toBe('edit f\nadd g\nmain work\nbase');
    sh('switch', '-q', 'main');
    write('f.txt', 'main edit\n');
    sh('commit', '-qam', 'main edit');
    sh('switch', '-q', 'feature');
    expect(await ops.rebase(root, 'main')).toBe('conflicts');
    expect((await git.read(root)).operation).toMatchObject({ kind: 'rebase', subject: 'feature' });
    await expect(ops.rebase(root, '--exec=rm')).rejects.toThrow('is not a branch');
  });
});
