import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { GitCli, GitCliError, isVersionAtLeast, parseGitVersion } from './cli';

describe('parseGitVersion', () => {
  it.each([
    ['git version 2.53.0\n', '2.53.0'],
    ['git version 2.47.1.windows.2', '2.47.1'],
    ['git version 2.39.5 (Apple Git-154)', '2.39.5'],
    ['bash: git: command not found', null],
  ])('%j → %j', (output, version) => expect(parseGitVersion(output)).toBe(version));
});

describe('isVersionAtLeast', () => {
  it('compares numerically, not lexically', () => {
    expect(isVersionAtLeast('2.30.0', '2.30.0')).toBe(true);
    expect(isVersionAtLeast('2.100.0', '2.30.0')).toBe(true);
    expect(isVersionAtLeast('2.29.9', '2.30.0')).toBe(false);
    expect(isVersionAtLeast('3.0.0', '2.30.0')).toBe(true);
  });
});

describe('GitCli', () => {
  const env = {
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const cli = new GitCli(directRunner());
  let repo: string;

  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-cli-')));
    await cli.exec(['init', '--initial-branch=main'], { cwd: repo, env });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('returns stdout of a successful command', async () => {
    const { stdout, exitCode } = await cli.exec(['rev-parse', '--show-toplevel'], { cwd: repo, readOnly: true });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(repo);
  });

  it("throws GitCliError carrying git's own fatal message", async () => {
    const error = await cli.exec(['rev-parse', 'no-such-ref'], { cwd: repo }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitCliError);
    expect(error).toMatchObject({ exitCode: 128, args: ['rev-parse', 'no-such-ref'] });
    expect((error as GitCliError).message).toMatch(/^git rev-parse no-such-ref failed: fatal: /);
  });

  it('accepts allowed exit codes as answers', async () => {
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    await cli.exec(['add', 'a.txt'], { cwd: repo, env });
    const { exitCode } = await cli.exec(['diff', '--cached', '--quiet'], { cwd: repo, allowedExitCodes: [1] });
    expect(exitCode).toBe(1);
  });

  it('sets a non-interactive environment, with optional locks off for read-only commands', async () => {
    // A shell alias prints the environment git hands to the commands it runs.
    const show = (readOnly: boolean) =>
      cli.exec(['-c', 'alias.showenv=!env', 'showenv'], { cwd: repo, readOnly }).then(({ stdout }) => stdout);
    const readOnly = await show(true);
    expect(readOnly).toContain('GIT_TERMINAL_PROMPT=0\n');
    expect(readOnly).toContain('GIT_EDITOR=:\n');
    expect(readOnly).toContain('LANGUAGE=en_US:en\n');
    expect(readOnly).toContain('GIT_OPTIONAL_LOCKS=0\n');
    expect(await show(false)).not.toContain('GIT_OPTIONAL_LOCKS');
  });

  it('does not hang on a command that would open an editor', async () => {
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    await cli.exec(['add', 'a.txt'], { cwd: repo, env });
    // GIT_EDITOR=: leaves the message empty, so git aborts instead of waiting for an editor.
    const error = await cli.exec(['commit'], { cwd: repo, env, timeoutMs: 10_000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitCliError);
    expect((error as GitCliError).message).toContain('empty commit message');
  });

  it('streams progress lines from stderr', async () => {
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    await cli.exec(['add', 'a.txt'], { cwd: repo, env });
    await cli.exec(['commit', '-m', 'first'], { cwd: repo, env });
    const target = join(repo, '..', `${repo.split(/[\\/]/).pop()}-clone`);
    const lines: string[] = [];
    try {
      // --no-local goes through the transport, which reports object counting/receiving progress.
      await cli.exec(['clone', '--progress', '--no-local', repo, target], { cwd: repo, onStderrLine: (l) => lines.push(l) });
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
    expect(lines[0]).toMatch(/^Cloning into /);
    expect(lines.some((line) => /^Receiving objects: +\d+%/.test(line))).toBe(true);
  });

  it('honours AbortSignal', async () => {
    const controller = new AbortController();
    const pending = cli.exec(['-c', 'alias.wait=!sleep 30', 'wait'], { cwd: repo, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports a missing git executable clearly', async () => {
    const missing = new GitCli(directRunner(), 'forklift-no-git');
    await expect(missing.exec(['status'], { cwd: repo })).rejects.toMatchObject({
      name: 'GitCliError',
      code: 'ENOENT',
      message: 'git executable "forklift-no-git" was not found',
    });
    expect(await missing.version()).toBeNull();
  });

  it('detects the installed version', async () => {
    const installed = execFileSync('git', ['--version']).toString();
    expect(await cli.version()).toBe(parseGitVersion(installed));
  });
});
