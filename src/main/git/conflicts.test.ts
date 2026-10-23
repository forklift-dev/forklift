import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConflicts } from '../../shared/conflicts';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { ConflictService } from './conflicts';
import { createGitService } from './service';

let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' }).toString().trim();
const shAllowFail = (...args: string[]) => {
  try {
    return sh(...args);
  } catch {
    return '';
  }
};
const write = (path: string, text: string) => writeFileSync(join(root, path), text);
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const service = new ConflictService(new GitCli(directRunner(env)));
const git = createGitService();

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-conflicts-')));
  sh('init', '-q', '--initial-branch=main');
  write('f.txt', 'a\nb\nc\n');
  write('gone.txt', 'will be deleted on feature\n');
  sh('add', '.');
  sh('commit', '-qm', 'base');
  sh('switch', '-qc', 'feature');
  write('f.txt', 'a\nB from feature\nc\n');
  sh('rm', '-q', 'gone.txt');
  sh('commit', '-qam', 'feature');
  sh('switch', '-q', 'main');
  write('f.txt', 'a\nB from main\nc\n');
  write('gone.txt', 'edited on main\n');
  sh('commit', '-qam', 'main');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('ConflictService', () => {
  it('reads the stages and the file with markers; the operation is a merge of feature', async () => {
    shAllowFail('merge', 'feature');
    const file = await service.read(root, 'f.txt');
    expect([file.base.text, file.ours.text, file.theirs.text]).toEqual(['a\nb\nc\n', 'a\nB from main\nc\n', 'a\nB from feature\nc\n']);
    expect(parseConflicts(file.merged.text!)).toMatchObject([{ ours: ['B from main'], theirs: ['B from feature'], oursLabel: 'HEAD', theirsLabel: 'feature' }]);
    expect((await git.read(root)).operation).toEqual({ kind: 'merge', subject: 'feature' });
    await expect(service.read(root, 'nothing.txt')).rejects.toThrow('not in conflict');
  });

  it('saves a resolution, refuses a stale one, marks resolved and continues the merge', async () => {
    shAllowFail('merge', 'feature');
    const file = await service.read(root, 'f.txt');
    await expect(service.save(root, 'f.txt', 'x\n', 'stale', false)).rejects.toThrow('changed on disk');
    await service.save(root, 'f.txt', 'a\nB merged\nc\n', file.merged.hash, true);
    expect(read('f.txt')).toBe('a\nB merged\nc\n');
    expect(sh('diff', '--name-only', '--diff-filter=U')).toBe('gone.txt');
    // Continue while a conflict remains: git refuses, the message says why.
    await expect(service.operation(root, { kind: 'merge' }, 'continue')).rejects.toThrow(/unmerged|not possible/i);
    // gone.txt: deleted by them → taking theirs deletes it.
    await service.take(root, 'gone.txt', 'theirs');
    expect(existsSync(join(root, 'gone.txt'))).toBe(false);
    await service.operation(root, { kind: 'merge' }, 'continue');
    expect(sh('log', '-1', '--format=%P').split(' ')).toHaveLength(2);
    expect(sh('log', '-1', '--format=%s')).toBe("Merge branch 'feature'");
    expect((await git.read(root)).operation).toBeNull();
  });

  it('takes our side of a whole file; aborts a merge', async () => {
    shAllowFail('merge', 'feature');
    await service.take(root, 'f.txt', 'ours');
    expect(read('f.txt')).toBe('a\nB from main\nc\n');
    expect(sh('diff', '--name-only', '--diff-filter=U')).toBe('gone.txt');
    await service.operation(root, { kind: 'merge' }, 'abort');
    expect((await git.read(root)).operation).toBeNull();
    expect(read('f.txt')).toBe('a\nB from main\nc\n');
  });

  it('reports rebase progress and skips or aborts it', async () => {
    sh('switch', '-q', 'feature');
    write('second.txt', 'second\n');
    sh('add', '.');
    sh('commit', '-qm', 'feature 2');
    shAllowFail('rebase', 'main');
    const operation = (await git.read(root)).operation;
    expect(operation).toMatchObject({ kind: 'rebase', step: 1, total: 2, subject: 'feature' });
    await expect(service.operation(root, operation!, 'skip')).resolves.toBeUndefined();
    expect((await git.read(root)).operation).toBeNull();
    expect(sh('log', '-1', '--format=%s')).toBe('feature 2');

    sh('reset', '-q', '--hard', 'ORIG_HEAD');
    shAllowFail('rebase', 'main');
    await service.operation(root, { kind: 'rebase' }, 'abort');
    expect((await git.read(root)).operation).toBeNull();
    expect(sh('rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature');
  });
});
