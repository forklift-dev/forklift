import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changeLines, type LineAction, type LineActionRequest } from '../../shared/staging';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { textChanges } from './lineDiff.testkit';
import { createGitService } from './service';
import { StagingError, StagingService } from './staging';

const env = {
  GIT_AUTHOR_NAME: 'Ada',
  GIT_AUTHOR_EMAIL: 'ada@example.com',
  GIT_COMMITTER_NAME: 'Ada',
  GIT_COMMITTER_EMAIL: 'ada@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: tmpdir(), // no user config (hooks, signing) leaks into the tests
};

describe.skipIf(process.platform === 'win32')('StagingService', () => {
  const reader = createGitService();
  const staging = new StagingService(new GitCli(directRunner({ ...process.env, ...env } as Record<string, string>)), reader);
  let root: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env: { ...process.env, ...env } }).toString();
  const write = (path: string, content: string | Buffer) => writeFileSync(join(root, path), content);
  const read = (path: string) => readFileSync(join(root, path), 'utf8');

  const ten = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const twoEdits = ten.replace('line 2\n', 'LINE TWO\n').replace('line 9\n', 'LINE NINE\n');

  /** Builds a request the way the window does: changes from the current diff, picking whole hunks. */
  async function request(action: LineAction, path: string, hunks: number[]): Promise<LineActionRequest> {
    const diff = await reader.fileDiff(root, { kind: 'worktree', path, staged: action === 'unstage' });
    const changes = textChanges(diff.original.text ?? '', diff.modified.text ?? '');
    const picked = hunks.map((i) => changeLines(changes[i]!));
    return {
      action,
      path,
      originalHash: diff.original.hash!,
      modifiedHash: diff.modified.hash!,
      changes,
      selectedOriginal: picked.flatMap((p) => p.original),
      selectedModified: picked.flatMap((p) => p.modified),
    };
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-staging-')));
    git('init', '-q', '--initial-branch=main');
    write('f.txt', ten);
    git('add', '.');
    git('commit', '-qm', 'base');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('stages one hunk and leaves the other unstaged', async () => {
    write('f.txt', twoEdits);
    await staging.applyLines(root, await request('stage', 'f.txt', [0]));
    expect(git('show', ':f.txt')).toBe(ten.replace('line 2\n', 'LINE TWO\n'));
    expect(read('f.txt')).toBe(twoEdits); // working tree untouched
  });

  it('stages single lines of a hunk', async () => {
    write('f.txt', ten.replace('line 5\n', 'new A\nnew B\n'));
    const req = await request('stage', 'f.txt', []);
    // Pick only the addition "new B" (modified line 6); the removal of "line 5" stays unpicked.
    await staging.applyLines(root, { ...req, selectedModified: [6] });
    expect(git('show', ':f.txt')).toBe(ten.replace('line 5\n', 'line 5\nnew B\n'));
  });

  it('unstages one hunk', async () => {
    write('f.txt', twoEdits);
    git('add', 'f.txt');
    await staging.applyLines(root, await request('unstage', 'f.txt', [1]));
    expect(git('show', ':f.txt')).toBe(ten.replace('line 2\n', 'LINE TWO\n'));
  });

  it('discards one hunk in the working tree, keeping the file mode', async () => {
    chmodSync(join(root, 'f.txt'), 0o755);
    write('f.txt', twoEdits);
    await staging.applyLines(root, await request('discard', 'f.txt', [0]));
    expect(read('f.txt')).toBe(ten.replace('line 9\n', 'LINE NINE\n'));
    expect((await import('node:fs')).statSync(join(root, 'f.txt')).mode & 0o111).not.toBe(0);
  });

  it('refuses a stale view', async () => {
    write('f.txt', twoEdits);
    const req = await request('stage', 'f.txt', [0]);
    write('f.txt', twoEdits + 'more\n');
    await expect(staging.applyLines(root, req)).rejects.toThrow('changed since it was shown');
    expect(git('diff', '--cached')).toBe('');
  });

  it('stages part of a new file with the working-tree mode', async () => {
    write('new.sh', '#!/bin/sh\necho one\necho two\n');
    chmodSync(join(root, 'new.sh'), 0o755);
    const req = await request('stage', 'new.sh', [0]);
    await staging.applyLines(root, { ...req, selectedModified: [1, 2] });
    expect(git('show', ':new.sh')).toBe('#!/bin/sh\necho one\n');
    expect(git('ls-files', '--stage', 'new.sh')).toMatch(/^100755 /);
  });

  it('cleans CRLF to LF through autocrlf like git add', async () => {
    git('config', 'core.autocrlf', 'true');
    write('f.txt', twoEdits.replaceAll('\n', '\r\n'));
    await staging.applyLines(root, await request('stage', 'f.txt', [0]));
    expect(git('show', ':f.txt')).toBe(ten.replace('line 2\n', 'LINE TWO\n'));
  });

  it('discards into a CRLF checkout with CRLF line endings', async () => {
    git('config', 'core.autocrlf', 'true');
    write('f.txt', twoEdits.replaceAll('\n', '\r\n'));
    await staging.applyLines(root, await request('discard', 'f.txt', [0]));
    expect(read('f.txt')).toBe(ten.replace('line 9\n', 'LINE NINE\n').replaceAll('\n', '\r\n'));
  });

  it('keeps a byte-order mark', async () => {
    write('bom.txt', '﻿first\n');
    git('add', 'bom.txt');
    git('commit', '-qm', 'bom');
    write('bom.txt', '﻿first\nsecond\n');
    await staging.applyLines(root, await request('stage', 'bom.txt', [0]));
    expect(git('show', ':bom.txt')).toBe('﻿first\nsecond\n');
  });

  it.each([
    ['an LFS-filtered file', () => write('.gitattributes', 'f.txt filter=lfs\n'), 'filter'],
    ['non-UTF-8 text', () => write('f.txt', Buffer.from('caf\xe9\n', 'latin1')), 'UTF-8'],
  ])('refuses line staging for %s', async (_name, setup, message) => {
    write('f.txt', twoEdits);
    const req = await request('stage', 'f.txt', [0]);
    setup();
    const fresh = await request('stage', 'f.txt', []).catch(() => req);
    await expect(staging.applyLines(root, { ...fresh, selectedModified: fresh.changes.length ? changeLines(fresh.changes[0]!).modified : [] })).rejects.toThrow(message);
  });

  it('refuses line staging for symlinks', async () => {
    symlinkSync('f.txt', join(root, 'link'));
    git('add', 'link');
    git('commit', '-qm', 'link');
    unlinkSync(join(root, 'link'));
    symlinkSync('other-target', join(root, 'link'));
    await expect(staging.applyLines(root, await request('stage', 'link', [0]))).rejects.toThrow(StagingError);
  });

  it('stages, unstages and discards whole files, including deletions and untracked files', async () => {
    write('f.txt', twoEdits);
    write('untracked.txt', 'x\n');
    unlinkSync(join(root, 'f.txt'));
    await staging.stageFiles(root, ['f.txt']);
    expect(git('status', '--porcelain')).toContain('D  f.txt');

    await staging.unstageFiles(root, ['f.txt'], false);
    expect(git('status', '--porcelain')).toContain(' D f.txt');

    await staging.discardFiles(root, ['f.txt'], ['untracked.txt']);
    expect(git('status', '--porcelain')).toBe('');
    expect(read('f.txt')).toBe(ten);
  });

  it('unstages in a repository without commits', async () => {
    rmSync(join(root, '.git'), { recursive: true, force: true });
    git('init', '-q', '--initial-branch=main');
    git('add', 'f.txt');
    await staging.unstageFiles(root, ['f.txt'], true);
    expect(git('status', '--porcelain')).toBe('?? f.txt\n');
  });

  it('commits, amends, and reports hook output on failure', async () => {
    write('f.txt', twoEdits);
    git('add', 'f.txt');
    const sha = await staging.commit(root, 'Subject line\n\nBody text.', false);
    expect(git('log', '-1', '--format=%H%n%B').trim()).toBe(`${sha}\nSubject line\n\nBody text.`);

    const amended = await staging.commit(root, 'Better subject', true);
    expect(amended).not.toBe(sha);
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('2');

    write('.git/hooks/pre-commit', '#!/bin/sh\necho "lint: 2 problems found in f.txt"\nexit 1\n');
    chmodSync(join(root, '.git/hooks/pre-commit'), 0o755);
    write('f.txt', ten);
    git('add', 'f.txt');
    await expect(staging.commit(root, 'Blocked', false)).rejects.toThrow('lint: 2 problems found in f.txt');
  });
});
