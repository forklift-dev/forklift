import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { GitCli } from '../git/cli';
import { GitToolSetup } from './gitToolSetup';

describe('GitToolSetup', () => {
  let dir: string;
  const create = () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-tool-setup-')));
    const env = { ...process.env, HOME: dir, GIT_CONFIG_GLOBAL: join(dir, 'global'), GIT_CONFIG_NOSYSTEM: '1' };
    mkdirSync(join(dir, 'repo'));
    writeFileSync(join(dir, 'repo', '.gitconfig'), '');
    execFileSync('git', ['init', '-q', join(dir, 'repo')], { env });
    const runnerEnv = { PATH: process.env['PATH'] ?? '', HOME: dir, GIT_CONFIG_GLOBAL: join(dir, 'global'), GIT_CONFIG_NOSYSTEM: '1' };
    const cli = new GitCli(directRunner(runnerEnv));
    const setup = new GitToolSetup(cli);
    const git = (...args: string[]) => execFileSync('git', ['config', '--local', ...args], { cwd: join(dir, 'repo'), env }).toString().trim();
    return { setup, git, cwd: join(dir, 'repo') };
  };
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('dry-run returns a plan without writing config', async () => {
    const { setup, git, cwd } = create();
    const plan = await setup.setup(cwd, 'local', ['/opt/Forklift App/forklift'], true);
    expect(plan.map(({ key }) => key)).toContain('difftool.forklift.cmd');
    expect(() => git('--get', 'diff.tool')).toThrow();
  });

  it('restores all previous values on uninstall and removes newly introduced keys', async () => {
    const { setup, git, cwd } = create();
    git('--add', 'diff.tool', 'meld');
    git('--add', 'diff.tool', 'kdiff3');
    git('--add', 'mergetool.forklift.cmd', 'my-old-merge "$LOCAL"');
    await setup.setup(cwd, 'local', ['/opt/Forklift App/forklift']);
    expect(git('--get', 'diff.tool')).toBe('forklift');
    expect(git('--get', 'difftool.forklift.cmd')).toContain('"difftool" "--local" "$LOCAL"');
    expect(git('--get', 'mergetool.forklift.cmd')).toContain('"mergetool" "--base" "$BASE"');
    expect(git('--get', 'mergetool.forklift.trustExitCode')).toBe('true');

    await setup.uninstall(cwd, 'local');
    expect(git('--get-all', 'diff.tool').split('\n')).toEqual(['meld', 'kdiff3']);
    expect(git('--get', 'mergetool.forklift.cmd')).toBe('my-old-merge "$LOCAL"');
    expect(() => git('--get', 'difftool.forklift.cmd')).toThrow();
    await expect(setup.uninstall(cwd, 'local')).rejects.toThrow('not configured');
  });

  it('does not overwrite an existing backup record', async () => {
    const { setup, git, cwd } = create();
    await setup.setup(cwd, 'local', ['/opt/forklift']);
    await expect(setup.setup(cwd, 'local', ['/opt/other'])).rejects.toThrow('already configured');
    expect(git('--get', 'difftool.forklift.cmd')).toContain('/opt/forklift');
  });
});
