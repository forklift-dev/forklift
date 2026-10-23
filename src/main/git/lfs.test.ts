import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lfsAttributeLine, parseLfsPointer } from '../../shared/lfs';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { LfsService, lfsPatterns } from './lfs';
import { createGitService } from './service';

let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' }).toString().trim();
const git = new GitCli(directRunner(env));
const noRemote = { networkCommand: async () => '' };
const hasLfs = (() => {
  try {
    execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const pointer = (content: string) => {
  const oid = createHash('sha256').update(content).digest('hex');
  return { oid, text: `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${Buffer.byteLength(content)}\n` };
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-lfs-')));
  sh('init', '-q', '--initial-branch=main');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('pointers and patterns', () => {
  it('reads LFS pointers and nothing else', () => {
    const { oid, text } = pointer('big');
    expect(parseLfsPointer(text)).toEqual({ oid, size: 3 });
    expect(parseLfsPointer('version https://git-lfs.github.com/spec/v1\nsize 3\n')).toBeNull();
    expect(parseLfsPointer('hello')).toBeNull();
    expect(parseLfsPointer(null)).toBeNull();
  });

  it('finds the LFS patterns of .gitattributes', () => {
    expect(lfsPatterns(`# art\n*.psd filter=lfs diff=lfs merge=lfs -text\n*.txt text\nmy[[:space:]]file.bin filter=lfs -text\n`)).toEqual(['*.psd', 'my file.bin']);
    expect(lfsAttributeLine('my file.bin')).toBe('my[[:space:]]file.bin filter=lfs diff=lfs merge=lfs -text');
  });
});

describe('LfsService', () => {
  it('tells which files are in LFS (without git-lfs)', async () => {
    writeFileSync(join(root, '.gitattributes'), '*.psd filter=lfs diff=lfs merge=lfs -text\n');
    const service = new LfsService(git, noRemote);
    const info = await service.info(root, ['art/cover.psd', 'README.md']);
    expect(info.patterns).toEqual(['*.psd']);
    expect(info.paths).toEqual(['art/cover.psd']);
    expect(info.installed === null).toBe(!hasLfs);
  });

  it.skipIf(hasLfs)('explains that git-lfs is missing when it is needed', async () => {
    const service = new LfsService(git, noRemote);
    await expect(service.track(root, '*.psd')).rejects.toThrow(/git-lfs is not installed/);
    await expect(service.download(root, true, { signal: new AbortController().signal, onProgress: () => {} })).rejects.toThrow(/git-lfs is not installed/);
  });

  it('tracks and untracks patterns in .gitattributes', async () => {
    writeFileSync(join(root, '.gitattributes'), '*.txt text');
    // As if git-lfs were installed: tracking only edits .gitattributes.
    const service = new (class extends LfsService {
      override async version() {
        return '3.6.0';
      }
    })(git, noRemote);
    await service.track(root, '*.psd');
    await service.track(root, 'my file.bin');
    await service.track(root, '*.psd');
    expect(readFileSync(join(root, '.gitattributes'), 'utf8')).toBe(`*.txt text\n${lfsAttributeLine('*.psd')}\n${lfsAttributeLine('my file.bin')}\n`);
    await service.untrack(root, '*.psd');
    expect(readFileSync(join(root, '.gitattributes'), 'utf8')).toBe(`*.txt text\n${lfsAttributeLine('my file.bin')}\n`);
    await expect(service.untrack(root, '*.psd')).rejects.toThrow(/not tracked/);
    await expect(service.track(root, '!negated')).rejects.toThrow(/file pattern/);
  });
});

describe('LFS files in diffs', () => {
  it('shows the content of downloaded objects, and the pointer of missing ones', async () => {
    const reader = createGitService();
    const first = pointer('first version\n');
    const second = pointer('second version\n');
    writeFileSync(join(root, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    writeFileSync(join(root, 'data.bin'), first.text);
    sh('add', '.');
    sh('commit', '-qm', 'pointer');
    // The first object is downloaded; the working tree has the second pointer, whose object is not.
    const store = join(root, '.git', 'lfs', 'objects', first.oid.slice(0, 2), first.oid.slice(2, 4));
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, first.oid), 'first version\n');
    writeFileSync(join(root, 'data.bin'), second.text);
    const diff = await reader.fileDiff(root, { kind: 'worktree', path: 'data.bin', staged: false });
    expect(diff.original).toMatchObject({ text: 'first version\n', lfs: { oid: first.oid, size: 14, downloaded: true } });
    expect(diff.modified).toMatchObject({ text: second.text, lfs: { oid: second.oid, downloaded: false } });
  });
});
