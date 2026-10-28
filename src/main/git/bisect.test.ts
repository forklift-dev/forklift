import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import type { Runner } from '../process/types';
import { GitCli } from './cli';
import { RepoQueue } from './repoQueue';
import { BisectService } from './bisect';

let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' }).toString().trim();
let omitBisectLogSummary = false;
const nativeRunner = directRunner(env);
const runner: Runner = {
  environment: () => nativeRunner.environment(),
  launch: (command, args, options) => nativeRunner.launch(command, args, options),
  run: async (command, args, options) => {
    const result = await nativeRunner.run(command, args, options);
    if (omitBisectLogSummary && args[0] === 'bisect' && args[1] === 'log') {
      return { ...result, stdout: result.stdout.replace(/^# first bad commit:.*\n?/m, '') };
    }
    return result;
  },
};
const service = new BisectService(new GitCli(runner), new RepoQueue());

beforeEach(() => {
  omitBisectLogSummary = false;
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-bisect-')));
  sh('init', '-q', '--initial-branch=main');
  for (let i = 0; i < 7; i++) {
    writeFileSync(join(root, 'version.txt'), `${i}\n`);
    sh('add', '.');
    sh('commit', '-qm', `version ${i}`);
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('marks commits, shows candidates and restores the branch after reset', async () => {
  const bad = sh('rev-parse', 'HEAD');
  const good = sh('rev-parse', 'HEAD~6');
  expect(await service.status(root)).toBeNull();
  await service.mark(root, 'bad', bad);
  await service.mark(root, 'good', good);
  const status = await service.status(root);
  expect(status?.bad).toBe(bad);
  expect(status?.good).toContain(good);
  expect(status?.candidates).toContain(bad);
  expect(status?.candidates).not.toContain(good);
  expect(status?.remaining).toBe(6);
  await service.reset(root);
  expect(await service.status(root)).toBeNull();
  expect(sh('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
});

it('runs an argv-only test to find the first bad commit', async () => {
  const bad = sh('rev-parse', 'HEAD');
  const good = sh('rev-parse', 'HEAD~6');
  const culprit = sh('rev-parse', 'HEAD~3');
  await service.mark(root, 'bad', bad);
  await service.mark(root, 'good', good);
  const activity: string[] = [];
  // Older Git builds may omit this line from `git bisect log`; the service must fall back to run output.
  omitBisectLogSummary = true;
  await service.run(root, process.execPath, ['-e', "process.exit(Number(require('fs').readFileSync('version.txt','utf8')) >= 3 ? 1 : 0)"], (state) => activity.push(...state.output));
  expect(activity.join('')).toContain(culprit);
  expect(activity.join('')).toMatch(/first bad commit/i);
  expect(activity.join('')).toMatch(new RegExp(`${culprit}\\s+is the first bad commit`, 'i'));
  expect((await service.status(root))?.found).toBe(culprit);
  await service.reset(root);
});

it('rejects a dirty worktree and skip before the first mark', async () => {
  writeFileSync(join(root, 'version.txt'), 'dirty\n');
  await expect(service.mark(root, 'bad', sh('rev-parse', 'HEAD'))).rejects.toThrow('Commit or stash');
  await expect(service.mark(root, 'skip', sh('rev-parse', 'HEAD'))).rejects.toThrow('Mark a good or bad');
  expect(await service.status(root)).toBeNull();
});

it('accepts a good mark first and records skipped commits', async () => {
  const good = sh('rev-parse', 'HEAD~6');
  const bad = sh('rev-parse', 'HEAD');
  await service.mark(root, 'good', good);
  expect((await service.status(root))?.remaining).toBeNull();
  await service.mark(root, 'bad', bad);
  const skipped = sh('rev-parse', 'HEAD');
  await service.mark(root, 'skip', skipped);
  expect((await service.status(root))?.skipped).toContain(skipped);
  expect((await service.status(root))?.candidates).not.toContain(skipped);
  await service.reset(root);
});

it('stops a running script and leaves the session resumable', async () => {
  await service.mark(root, 'bad', sh('rev-parse', 'HEAD'));
  await service.mark(root, 'good', sh('rev-parse', 'HEAD~6'));
  let started!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const run = service.run(root, process.execPath, ['-e', "console.log('ready'); setTimeout(() => process.exit(0), 30000)"], (state) => { if (state.output.includes('ready')) started(); });
  await running;
  service.cancel(root);
  await expect(run).rejects.toThrow();
  expect(await service.status(root)).not.toBeNull();
  await service.reset(root);
});
