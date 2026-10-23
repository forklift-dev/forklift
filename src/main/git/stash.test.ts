import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EdgeKind } from '../../shared/graph';
import { HistoryService } from '../history/service';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { createGitService } from './service';
import { StashService } from './stash';

let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env }).toString().trim();
const write = (path: string, text: string) => writeFileSync(join(root, path), text);
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const service = new StashService(new GitCli(directRunner(env)));
const git = createGitService();

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-stash-')));
  sh('init', '-q', '--initial-branch=main');
  write('a.txt', 'one\n');
  write('b.txt', 'bee\n');
  sh('add', '.');
  sh('commit', '-qm', 'base');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('StashService', () => {
  it('stashes with a message and untracked files, lists them, applies, pops and drops by sha', async () => {
    write('a.txt', 'two\n');
    write('new.txt', 'untracked\n');
    const first = await service.push(root, { message: 'my work', includeUntracked: true, stagedOnly: false });
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    expect(read('a.txt')).toBe('one\n');
    expect(existsSync(join(root, 'new.txt'))).toBe(false);

    write('b.txt', 'second stash\n');
    const second = await service.push(root, { message: '', includeUntracked: false, stagedOnly: false });
    const data = await git.read(root);
    expect(data.stashes.map((s) => [s.index, s.sha])).toEqual([[0, second], [1, first]]);
    expect(data.stashes[1]).toMatchObject({ message: 'On main: my work', base: sh('rev-parse', 'HEAD') });
    expect(data.stashes[0]!.message).toMatch(/^WIP on main/);

    // Apply the older one (by sha, although it is stash@{1}); it stays.
    expect(await service.apply(root, first!, false)).toEqual({ outcome: 'applied', detail: null });
    expect(read('a.txt')).toBe('two\n');
    expect(read('new.txt')).toBe('untracked\n');
    expect(sh('stash', 'list', '--format=%H').split('\n')).toEqual([second, first]);

    await service.drop(root, first!);
    expect(sh('stash', 'list', '--format=%H')).toBe(second);
    sh('reset', '-q', '--hard');
    sh('clean', '-qfd');
    expect(await service.apply(root, second!, true)).toEqual({ outcome: 'applied', detail: null });
    expect(read('b.txt')).toBe('second stash\n');
    expect(sh('stash', 'list')).toBe('');
  });

  it('nothing to stash gives null; a dropped stash is reported', async () => {
    expect(await service.push(root, { message: 'x', includeUntracked: true, stagedOnly: false })).toBeNull();
    await expect(service.drop(root, 'a'.repeat(40))).rejects.toThrow('does not exist');
  });

  it('keeps the stash on conflicts when popping', async () => {
    write('a.txt', 'stashed\n');
    const sha = await service.push(root, { message: 'm', includeUntracked: false, stagedOnly: false });
    write('a.txt', 'committed meanwhile\n');
    sh('commit', '-qam', 'meanwhile');
    const result = await service.apply(root, sha!, true);
    expect(result).toEqual({ outcome: 'conflicts', detail: 'a.txt' });
    expect(sh('stash', 'list', '--format=%H')).toBe(sha);
  });

  it('stashes only staged changes on git 2.35+', async () => {
    write('a.txt', 'staged\n');
    sh('add', 'a.txt');
    write('b.txt', 'unstaged\n');
    await service.push(root, { message: 'staged only', includeUntracked: false, stagedOnly: true });
    expect(read('a.txt')).toBe('one\n');
    expect(read('b.txt')).toBe('unstaged\n');
    await expect(service.push(root, { message: '', includeUntracked: true, stagedOnly: true })).rejects.toThrow('cannot be stashed together');
  });
});

describe('stashes in history and details', () => {
  it('draws a stash right above its base with a line into it, and changes the history version', async () => {
    write('a.txt', 'two\n');
    write('new.txt', 'untracked\n');
    const before = (await git.read(root)).historyVersion;
    const sha = await service.push(root, { message: 'wip', includeUntracked: true, stagedOnly: false });
    const data = await git.read(root);
    expect(data.historyVersion).not.toBe(before);
    const { rows } = await new HistoryService().page(root, data.historyVersion, 0, 10);
    expect(rows.map((r) => [r.subject, r.stash?.index ?? null])).toEqual([['On main: wip', 0], ['base', null]]);
    expect(rows[0]!.parents).toEqual([data.stashes[0]!.base]);
    expect(rows[1]!.graph.edges.some((e) => e.kind === EdgeKind.In)).toBe(true);

    const details = await git.stashDetails(root, sha!);
    expect(details.files.map((f) => [f.path, f.status, f.sourceSha ? 'untracked' : 'tracked'])).toEqual([
      ['a.txt', 'modified', 'tracked'],
      ['new.txt', 'added', 'untracked'],
    ]);
    const untracked = details.files.find((f) => f.path === 'new.txt')!;
    const diff = await git.fileDiff(root, { kind: 'commit', sha: untracked.sourceSha!, path: 'new.txt' });
    expect(diff.modified.text).toBe('untracked\n');
    expect(diff.original.exists).toBe(false);
  });
});
