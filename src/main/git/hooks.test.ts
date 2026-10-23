import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { listHooks } from './hooks';
import { createGitService } from './service';
import { StagingService } from './staging';

let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' }).toString().trim();
const git = new GitCli(directRunner(env));
const hook = (dir: string, name: string, body: string, executable = true) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, name), executable ? 0o755 : 0o644);
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-hooks-')));
  sh('init', '-q', '--initial-branch=main');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  sh('add', '.');
  sh('commit', '-qm', 'init');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('listHooks', () => {
  it('lists executable hooks of .git/hooks, not samples or plain files', async () => {
    const dir = join(root, '.git', 'hooks');
    hook(dir, 'pre-commit', 'exit 0');
    hook(dir, 'commit-msg', 'exit 0', false);
    expect(await listHooks(git, root)).toEqual({ dir, hooks: ['pre-commit'] });
  });

  it('follows core.hooksPath', async () => {
    hook(join(root, '.githooks'), 'pre-push', 'exit 0');
    sh('config', 'core.hooksPath', '.githooks');
    expect(await listHooks(git, root)).toEqual({ dir: join(root, '.githooks'), hooks: ['pre-push'] });
  });
});

describe('commits and hooks', () => {
  it('streams hook output, reports a failing hook, and skips hooks when asked', async () => {
    hook(join(root, '.git', 'hooks'), 'pre-commit', 'echo "checking style"\necho "lint failed: a.txt" >&2\nexit 1');
    const staging = new StagingService(git, createGitService());
    writeFileSync(join(root, 'a.txt'), 'b\n');
    sh('add', '.');
    const lines: string[] = [];
    await expect(staging.commit(root, 'Change\n', false, { onOutput: (line) => lines.push(line) })).rejects.toThrow(/Commit failed:[\s\S]*lint failed: a\.txt/);
    expect(lines).toEqual(expect.arrayContaining(['checking style', 'lint failed: a.txt']));
    await staging.commit(root, 'Change\n', false, { skipHooks: true });
    expect(sh('log', '-1', '--format=%s')).toBe('Change');
  });
});
