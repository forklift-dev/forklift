import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import type { Runner } from '../process/types';
import { BranchService } from './branches';
import { GitCli } from './cli';

let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env }).toString().trim();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const write = (path: string, text: string) => writeFileSync(join(root, path), text);
let forceUntrackedCollisionExit128 = false;
const nativeRunner = directRunner(env);
const runner: Runner = {
  environment: () => nativeRunner.environment(),
  launch: (command, args, options) => nativeRunner.launch(command, args, options),
  run: (command, args, options) => {
    if (forceUntrackedCollisionExit128 && args[0] === 'stash' && args[1] === 'apply') {
      return Promise.resolve({
        code: 128,
        signal: null,
        stdout: 'Already up to date.\nOn branch feature\nnothing to commit, working tree clean\n',
        stderr: 'report.txt already exists, no checkout\nerror: could not restore untracked files from stash\n',
        durationMs: 0,
        timedOut: false,
        truncated: false,
        cancelled: false,
      });
    }
    return nativeRunner.run(command, args, options);
  },
};
const service = new BranchService(new GitCli(runner));
const stashes = () => sh('stash', 'list');
const head = () => sh('rev-parse', '--abbrev-ref', 'HEAD');

beforeEach(() => {
  forceUntrackedCollisionExit128 = false;
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-branches-')));
  sh('init', '-q', '--initial-branch=main');
  write('shared.txt', 'line 1\nline 2\nline 3\n');
  write('other.txt', 'other\n');
  sh('add', '.');
  sh('commit', '-qm', 'base');
  sh('branch', 'feature');
  sh('switch', '-q', 'feature');
  write('shared.txt', 'line 1\nline 2 on feature\nline 3\n');
  sh('commit', '-qam', 'feature change');
  sh('switch', '-q', 'main');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('BranchService.checkout with automatic stash', () => {
  it('lists only local branches merged into HEAD for cleanup suggestions', async () => {
    sh('branch', 'merged-copy', 'HEAD');
    expect(await service.mergedLocalBranches(root)).toEqual(['main', 'merged-copy']);
    expect(head()).toBe('main');
  });

  it('switches a clean working tree without stashing', async () => {
    expect(await service.checkout(root, { kind: 'branch', name: 'feature' })).toEqual({ stash: 'none', message: null });
    expect(head()).toBe('feature');
    expect(stashes()).toBe('');
  });

  it('carries changes that do not conflict, staged ones staged, untracked ones too', async () => {
    write('other.txt', 'other edited\n');
    sh('add', 'other.txt');
    write('notes.md', 'untracked\n');
    const result = await service.checkout(root, { kind: 'branch', name: 'feature' });
    expect(result).toEqual({ stash: 'restored', message: null });
    expect(head()).toBe('feature');
    expect(read('other.txt')).toBe('other edited\n');
    expect(read('notes.md')).toBe('untracked\n');
    expect(read('shared.txt')).toContain('on feature');
    expect(sh('diff', '--cached', '--name-only')).toBe('other.txt');
    expect(stashes()).toBe('');
  });

  it('keeps the stash and reports the conflict when the changes clash with the target', async () => {
    write('shared.txt', 'line 1\nline 2 edited on main\nline 3\n');
    const result = await service.checkout(root, { kind: 'branch', name: 'feature' });
    expect(result.stash).toBe('conflicts');
    expect(result.message).toMatch(/Switched to feature\. .*conflict with it in shared\.txt.*kept in the stash "Forklift: changes from before switching to feature"/);
    expect(head()).toBe('feature');
    expect(read('shared.txt')).toMatch(/<<<<<<<[\s\S]*line 2 on feature[\s\S]*line 2 edited on main[\s\S]*>>>>>>>/);
    expect(stashes()).toMatch(/Forklift: changes from before switching to feature/);
  });

  it('keeps the stash when an untracked file collides with a file of the target', async () => {
    sh('switch', '-q', 'feature');
    write('report.txt', 'tracked on feature\n');
    sh('add', 'report.txt');
    sh('commit', '-qm', 'add report');
    sh('switch', '-q', 'main');
    write('report.txt', 'my untracked notes\n');
    forceUntrackedCollisionExit128 = true;
    const result = await service.checkout(root, { kind: 'branch', name: 'feature' });
    expect(result.stash).toBe('kept');
    expect(result.message).toMatch(/could not be put back .*safe in the stash/);
    expect(read('report.txt')).toBe('tracked on feature\n');
    expect(stashes()).toMatch(/Forklift/);
  });

  it('puts the changes back when the switch itself fails', async () => {
    write('other.txt', 'mine\n');
    // A post-checkout hook cannot stop a switch, but a missing branch can.
    await expect(service.checkout(root, { kind: 'branch', name: 'nope' })).rejects.toThrow('nope does not exist');
    expect(read('other.txt')).toBe('mine\n');
    // Simulate a failing switch after stashing: a locked index makes `git switch` fail.
    writeFileSync(join(root, '.git', 'index.lock'), '');
    await expect(service.checkout(root, { kind: 'branch', name: 'feature' })).rejects.toThrow();
    rmSync(join(root, '.git', 'index.lock'));
    expect(head()).toBe('main');
  });

  it('creating a branch at HEAD keeps changes untouched without a stash; elsewhere it stashes', async () => {
    write('other.txt', 'mine\n');
    const headSha = sh('rev-parse', 'HEAD');
    expect(await service.create(root, 'topic', headSha, true)).toEqual({ stash: 'none', message: null });
    expect(head()).toBe('topic');
    expect(read('other.txt')).toBe('mine\n');
    const featureSha = sh('rev-parse', 'feature');
    expect((await service.create(root, 'topic2', featureSha, true)).stash).toBe('restored');
    expect(head()).toBe('topic2');
    expect(read('other.txt')).toBe('mine\n');
    expect(read('shared.txt')).toContain('on feature');
  });

  it('checks out a commit detached, and a remote branch as a new tracking branch', async () => {
    const base = sh('rev-parse', 'main');
    await service.checkout(root, { kind: 'commit', sha: base });
    expect(head()).toBe('HEAD');
    sh('switch', '-q', 'main');
    // A fake remote: refs/remotes/origin/* in the same repository.
    sh('update-ref', 'refs/remotes/origin/review/x', sh('rev-parse', 'feature'));
    sh('config', 'remote.origin.url', root);
    sh('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    await service.checkout(root, { kind: 'remote', name: 'origin/review/x', remote: 'origin' });
    expect(head()).toBe('review/x');
    expect(sh('rev-parse', '--abbrev-ref', 'review/x@{upstream}')).toBe('origin/review/x');
    sh('switch', '-q', 'main');
    await expect(service.checkout(root, { kind: 'remote', name: 'origin/review/x', remote: 'origin' })).rejects.toThrow('already exists');
  });

  it('sets, changes and removes a branch’s upstream', async () => {
    sh('config', 'remote.origin.url', root);
    sh('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    sh('update-ref', 'refs/remotes/origin/feature', sh('rev-parse', 'feature'));
    sh('update-ref', 'refs/remotes/origin/main', sh('rev-parse', 'main'));
    // A local branch named like the remote one must not be taken for it.
    sh('branch', 'origin/main', 'feature');
    await service.setUpstream(root, 'feature', 'origin/feature');
    expect(sh('rev-parse', '--abbrev-ref', 'feature@{upstream}')).toBe('origin/feature');
    await service.setUpstream(root, 'main', 'origin/main');
    expect(sh('rev-parse', '--symbolic-full-name', 'main@{upstream}')).toBe('refs/remotes/origin/main');
    await service.setUpstream(root, 'feature', null);
    expect(() => sh('rev-parse', '--abbrev-ref', 'feature@{upstream}')).toThrow();
    await expect(service.setUpstream(root, 'feature', 'origin/nothing')).rejects.toThrow('origin/nothing does not exist');
    await expect(service.setUpstream(root, 'nothing', 'origin/main')).rejects.toThrow('nothing does not exist');
  });
});

describe('BranchService: names, rename, delete, tags', () => {
  it('validates names with git', async () => {
    expect(await service.invalidName(root, 'branch', 'good/name')).toBeNull();
    for (const bad of ['', 'two words', 'a..b', '-x', 'end.lock', 'x~1', 'HEAD^']) {
      expect(await service.invalidName(root, 'branch', bad)).not.toBeNull();
    }
    expect(await service.invalidName(root, 'tag', 'v1.0')).toBeNull();
    expect(await service.invalidName(root, 'tag', 'v1 0')).not.toBeNull();
    await expect(service.create(root, 'bad name', sh('rev-parse', 'HEAD'), false)).rejects.toThrow('not a valid branch name');
  });

  it('renames and deletes; unmerged branches need force', async () => {
    await service.rename(root, 'feature', 'feature-2');
    expect(sh('branch', '--format=%(refname:short)')).toBe('feature-2\nmain');
    await expect(service.delete(root, 'feature-2', false)).rejects.toThrow(/not fully merged/);
    await service.delete(root, 'feature-2', true);
    expect(sh('branch', '--format=%(refname:short)')).toBe('main');
    await expect(service.delete(root, 'main', true)).rejects.toThrow(/cannot delete|checked out/i);
  });

  it('creates lightweight and annotated tags and deletes them', async () => {
    const sha = sh('rev-parse', 'HEAD');
    await service.createTag(root, 'v1', sha, null);
    await service.createTag(root, 'v2', sha, 'Release 2\n\nWith notes; $(not a command)');
    expect(sh('cat-file', '-t', 'v1')).toBe('commit');
    expect(sh('cat-file', '-t', 'v2')).toBe('tag');
    expect(sh('tag', '-l', '--format=%(contents)', 'v2')).toBe('Release 2\n\nWith notes; $(not a command)');
    await service.deleteTag(root, 'v1');
    expect(sh('tag')).toBe('v2');
    expect(existsSync(join(root, '.git/refs/tags/v1'))).toBe(false);
  });
});
