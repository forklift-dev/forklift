import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { parseProgress, RemoteError, RemoteService, type RemoteProgress } from './remote';
import { createGitService } from './service';

let dir: string;
let origin: string;
let mine: string;
let theirs: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();
const noAskpass = { session: () => ({ env: {}, dispose: () => {} }) };
const service = new RemoteService(new GitCli(directRunner(env)), noAskpass);
const run = (progress: RemoteProgress[] = [], signal = new AbortController().signal) => ({ signal, onProgress: (p: RemoteProgress) => progress.push(p) });
const git = createGitService();

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-remote-')));
  origin = join(dir, 'origin.git');
  mine = join(dir, 'mine');
  theirs = join(dir, 'theirs');
  sh(dir, 'init', '-q', '--bare', '--initial-branch=main', origin);
  sh(dir, 'clone', '-q', origin, mine);
  writeFileSync(join(mine, 'f.txt'), 'base\n');
  sh(mine, 'add', '.');
  sh(mine, 'commit', '-qm', 'base');
  sh(mine, 'push', '-q', '-u', 'origin', 'main');
  sh(dir, 'clone', '-q', origin, theirs);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const theirCommit = (file: string, text: string, message: string) => {
  writeFileSync(join(theirs, file), text);
  sh(theirs, 'add', '.');
  sh(theirs, 'commit', '-qm', message);
  sh(theirs, 'push', '-q');
};

describe('parseProgress', () => {
  it('reads git progress lines', () => {
    expect(parseProgress('Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s')).toEqual({ phase: 'Receiving objects', percent: 45 });
    expect(parseProgress('remote: Counting objects: 100% (5/5), done.')).toEqual({ phase: 'Counting objects', percent: 100 });
    expect(parseProgress('From /tmp/origin')).toBeNull();
  });
});

describe('RemoteService', () => {
  it('fetches with progress and shows the remote branch moved', async () => {
    // Enough objects for git to report progress.
    for (let i = 0; i < 3; i++) theirCommit(`n${i}.txt`, `${i}\n`.repeat(2000), `theirs ${i}`);
    const progress: RemoteProgress[] = [];
    await service.fetch(mine, null, true, run(progress));
    expect(sh(mine, 'rev-parse', 'origin/main')).toBe(sh(theirs, 'rev-parse', 'HEAD'));
    expect((await git.read(mine)).branches.find((b) => b.name === 'main')).toMatchObject({ behind: 3, ahead: 0 });
    expect(progress.length).toBeGreaterThan(0);
  });

  it('pulls with merge or rebase, stopping on conflicts for the banner', async () => {
    theirCommit('t.txt', 'theirs\n', 'their work');
    writeFileSync(join(mine, 'm.txt'), 'mine\n');
    sh(mine, 'add', '.');
    sh(mine, 'commit', '-qm', 'my work');
    expect(await service.pull(mine, true, run())).toBe('done');
    expect(sh(mine, 'log', '--format=%s', '-3')).toBe('my work\ntheir work\nbase');

    theirCommit('f.txt', 'their f\n', 'their f');
    writeFileSync(join(mine, 'f.txt'), 'my f\n');
    sh(mine, 'commit', '-qam', 'my f');
    expect(await service.pull(mine, false, run())).toBe('conflicts');
    expect((await git.read(mine)).operation).toMatchObject({ kind: 'merge' });
  });

  it('pull carries uncommitted changes (autostash)', async () => {
    theirCommit('t.txt', 'theirs\n', 'their work');
    writeFileSync(join(mine, 'f.txt'), 'uncommitted\n');
    expect(await service.pull(mine, false, run())).toBe('done');
    expect(readFileSync(join(mine, 'f.txt'), 'utf8')).toBe('uncommitted\n');
    expect(readFileSync(join(mine, 't.txt'), 'utf8')).toBe('theirs\n');
  });

  it('pushes; a rejected push says so; force-with-lease overwrites', async () => {
    writeFileSync(join(mine, 'm.txt'), 'mine\n');
    sh(mine, 'add', '.');
    sh(mine, 'commit', '-qm', 'my work');
    await service.push(mine, null, false, run());
    expect(sh(origin, 'rev-parse', 'main')).toBe(sh(mine, 'rev-parse', 'HEAD'));

    sh(theirs, 'pull', '-q');
    theirCommit('t.txt', 'theirs\n', 'their work');
    sh(mine, 'commit', '-q', '--amend', '-m', 'my work, amended');
    sh(mine, 'fetch', '-q');
    const error = await service.push(mine, null, false, run()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemoteError);
    expect((error as RemoteError).rejected).toBe(true);
    await service.push(mine, null, true, run());
    expect(sh(origin, 'log', '-1', '--format=%s', 'main')).toBe('my work, amended');
  });

  it('pushes a new branch with --set-upstream when a remote is given, and explains otherwise', async () => {
    sh(mine, 'switch', '-qc', 'topic');
    await expect(service.push(mine, null, false, run())).rejects.toThrow('has no upstream branch');
    await service.push(mine, 'origin', false, run());
    expect(sh(mine, 'rev-parse', '--abbrev-ref', 'topic@{upstream}')).toBe('origin/topic');
    await expect(service.push(mine, '--receive-pack=evil', false, run())).rejects.toThrow('not a valid remote name');
  });

  it('cancels a running network command', async () => {
    // A remote whose upload-pack hangs: fetch would wait forever.
    sh(mine, 'config', 'remote.slow.url', origin);
    sh(mine, 'config', 'remote.slow.uploadpack', 'sleep 30; git-upload-pack');
    const controller = new AbortController();
    const fetching = service.fetch(mine, 'slow', false, run([], controller.signal));
    setTimeout(() => controller.abort(), 300);
    const started = Date.now();
    await expect(fetching).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
