import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { GitCli } from '../git/cli';
import { RemoteService } from '../git/remote';
import { createGitService } from '../git/service';
import { createAppStore } from '../store';
import { NetworkOps } from './network';
import { GroupSyncRunner, readGroupStatus } from './groupSync';

const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();
const noAskpass = { session: () => ({ env: {}, dispose: () => {} }) };

describe('repository group sync', () => {
  let dir: string;
  let origin: string;
  let local: string;
  let other: string;
  let service: ReturnType<typeof createGitService>;
  let cli: GitCli;
  let store: ReturnType<typeof createAppStore>;
  let runner: GroupSyncRunner;
  const group = () => ({ id: 'group-a', name: 'Group A', color: 2, repos: [local] });

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-group-')));
    origin = join(dir, 'origin.git');
    local = join(dir, 'local');
    other = join(dir, 'other');
    sh(dir, 'init', '-q', '--bare', '--initial-branch=main', origin);
    sh(dir, 'clone', '-q', origin, local);
    writeFileSync(join(local, 'base.txt'), 'base\n');
    sh(local, 'add', '.');
    sh(local, 'commit', '-qm', 'base');
    sh(local, 'push', '-q', '-u', 'origin', 'main');
    sh(dir, 'clone', '-q', origin, other);
    service = createGitService();
    cli = new GitCli(directRunner(env));
    store = createAppStore({ version: 'test', platform: process.platform }, { git: service as never });
    runner = new GroupSyncRunner(store, service, cli, new RemoteService(cli, noAskpass), new NetworkOps(store));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const remoteCommit = (file: string, content: string) => {
    writeFileSync(join(other, file), content);
    sh(other, 'add', '.');
    sh(other, 'commit', '-qm', `update ${file}`);
    sh(other, 'push', '-q');
  };

  it('fetches every remote and exposes the behind count in group status', async () => {
    remoteCommit('remote.txt', 'remote\n');
    await runner.run(group(), 'fetch');
    expect(sh(local, 'rev-parse', 'origin/main')).toBe(sh(other, 'rev-parse', 'HEAD'));
    expect(store.getState().app.groupSync?.repos[0]).toMatchObject({ status: 'ok' });
    expect(await readGroupStatus(group(), service, cli)).toMatchObject([{ branch: 'main', behind: 1, ahead: 0, dirty: false }]);
  });

  it('fast-forwards a clean branch and never creates a merge commit', async () => {
    remoteCommit('remote.txt', 'remote\n');
    await runner.run(group(), 'pull');
    expect(sh(local, 'rev-parse', 'HEAD')).toBe(sh(other, 'rev-parse', 'HEAD'));
    expect(sh(local, 'rev-list', '--count', 'HEAD')).toBe('2');
    expect(store.getState().app.groupSync?.repos[0]).toMatchObject({ status: 'ok', message: expect.stringContaining('Fast-forward') });
  });

  it('pulls a ten-repository group in one run', async () => {
    const repos = Array.from({ length: 10 }, (_, index) => join(dir, `member-${index}`));
    for (const path of repos) sh(dir, 'clone', '-q', origin, path);
    remoteCommit('shared.txt', 'shared update\n');
    await runner.run({ ...group(), repos }, 'pull');
    expect(repos.map((path) => sh(path, 'rev-parse', 'HEAD'))).toEqual(Array(10).fill(sh(other, 'rev-parse', 'HEAD')));
    expect(store.getState().app.groupSync?.repos.every((repo) => repo.status === 'ok')).toBe(true);
  });

  it('fetches but skips pulling when there are uncommitted changes', async () => {
    remoteCommit('remote.txt', 'remote\n');
    writeFileSync(join(local, 'local-change.txt'), 'keep me\n');
    await runner.run(group(), 'pull');
    expect(sh(local, 'rev-parse', 'HEAD')).not.toBe(sh(other, 'rev-parse', 'HEAD'));
    expect(sh(local, 'rev-parse', 'origin/main')).toBe(sh(other, 'rev-parse', 'HEAD'));
    expect(store.getState().app.groupSync?.repos[0]).toMatchObject({ status: 'skipped' });
    expect(await readGroupStatus(group(), service, cli)).toMatchObject([{ behind: 1, dirty: true }]);
  });

  it('keeps a diverged branch unchanged when fast-forward is impossible', async () => {
    writeFileSync(join(local, 'local.txt'), 'local\n');
    sh(local, 'add', '.');
    sh(local, 'commit', '-qm', 'local change');
    const localHead = sh(local, 'rev-parse', 'HEAD');
    remoteCommit('remote.txt', 'remote\n');
    await runner.run(group(), 'pull');
    expect(sh(local, 'rev-parse', 'HEAD')).toBe(localHead);
    expect(sh(local, 'status', '--porcelain')).toBe('');
    expect(store.getState().app.groupSync?.repos[0]?.status).toBe('failed');
  });

  it('marks repositories not yet started as cancelled', async () => {
    const pending = runner.run({ ...group(), repos: [local, other] }, 'fetch');
    runner.cancel();
    await pending;
    expect(store.getState().app.groupSync).toMatchObject({ done: true, repos: [{ status: 'skipped' }, { status: 'skipped' }] });
  });

  it('cancels the active repository update and marks remaining repositories skipped', async () => {
    sh(local, 'config', 'remote.slow.url', origin);
    sh(local, 'config', 'remote.slow.uploadpack', 'sleep 10; git-upload-pack');
    const started = Date.now();
    const pending = runner.run({ ...group(), repos: [local, other] }, 'fetch');
    setTimeout(() => runner.cancel(), 250);
    await pending;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(store.getState().app.groupSync?.repos.map((repo) => repo.status)).toEqual(['skipped', 'skipped']);
  });
});
