import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runProcess } from '../../process-host/spawn';
import { parseEnvBlock, resolveShellEnv, shellArgs, shouldResolveShellEnv, type RunText } from './shellEnv';

describe('shouldResolveShellEnv', () => {
  it('resolves for GUI launches on macOS and Linux only', () => {
    expect(shouldResolveShellEnv({}, 'darwin', false)).toBe(true);
    expect(shouldResolveShellEnv({}, 'linux', false)).toBe(true);
    expect(shouldResolveShellEnv({}, 'linux', true)).toBe(false);
    expect(shouldResolveShellEnv({}, 'win32', false)).toBe(false);
  });

  it('honours FORKLIFT_SHELL_ENV', () => {
    expect(shouldResolveShellEnv({ FORKLIFT_SHELL_ENV: 'force' }, 'linux', true)).toBe(true);
    expect(shouldResolveShellEnv({ FORKLIFT_SHELL_ENV: 'off' }, 'darwin', false)).toBe(false);
  });
});

describe('shellArgs', () => {
  it('builds interactive login invocations', () => {
    expect(shellArgs('/bin/zsh', 'S')).toEqual(['-i', '-l', '-c', 'S']);
    expect(shellArgs('/usr/local/bin/fish', 'S')).toEqual(['-i', '-l', '-c', 'S']);
    expect(shellArgs('/bin/tcsh', 'S')).toEqual(['-ic', 'S']);
    expect(shellArgs('/usr/bin/nu', 'S')).toBeNull();
  });
});

describe('parseEnvBlock', () => {
  const M = '__MARK__';

  it('extracts variables between markers, ignoring rc noise', () => {
    const output = `Welcome!\nnvm loaded\n${M}PATH=/a:/b\0EQ=x=y\0MULTI=line1\nline2\0_=/usr/bin/env\0SHLVL=2\0${M}bye\n`;
    expect(parseEnvBlock(output, M)).toEqual({ PATH: '/a:/b', EQ: 'x=y', MULTI: 'line1\nline2' });
  });

  it('rejects output without markers or without PATH', () => {
    expect(parseEnvBlock('PATH=/a\0', M)).toBeNull();
    expect(parseEnvBlock(`${M}HOME=/h\0${M}`, M)).toBeNull();
  });
});

// Integration: real login shells with throwaway rc files, run through the process-host spawn core.
const run: RunText = async (command, args, options) => {
  const result = await runProcess({ type: 'run', id: 0, command, args: [...args], streamOutput: false, ...options }).result;
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return { code: result.code, timedOut: result.timedOut, stdout: decode(result.stdout), stderr: decode(result.stderr) };
};

function which(name: string): string | null {
  try {
    return execFileSync('sh', ['-c', `command -v ${name}`]).toString().trim() || null;
  } catch {
    return null;
  }
}

// Each rc file prints noise, extends PATH, sets a multi-line value and records whether it saw the flag.
const RC_BODY = `
echo "hello from rc"
export PATH="$HOME/rcbin:$PATH"
export MULTI="first
second"
[ -n "$FORKLIFT_RESOLVING_ENVIRONMENT" ] && export SAW_FLAG=1
`;
const SHELLS: Array<{ name: string; rcFile: string; body?: string }> = [
  { name: 'bash', rcFile: '.bash_profile' },
  { name: 'zsh', rcFile: '.zshrc' },
  { name: 'dash', rcFile: '.profile' },
  {
    name: 'fish',
    rcFile: '.config/fish/config.fish',
    body: 'echo "hello from rc"\nset -gx PATH $HOME/rcbin $PATH\nset -gx MULTI "first\nsecond"\nset -q FORKLIFT_RESOLVING_ENVIRONMENT; and set -gx SAW_FLAG 1\n',
  },
];

describe.skipIf(process.platform === 'win32')('resolveShellEnv with real shells', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'forklift-shellenv-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const baseEnv = () => ({ HOME: home, PATH: '/usr/local/bin:/usr/bin:/bin', TERM: 'dumb', XDG_CONFIG_HOME: join(home, '.config') });

  for (const { name, rcFile, body } of SHELLS) {
    const shell = which(name);
    it.skipIf(!shell)(`picks up ${name} rc files`, async () => {
      execFileSync('mkdir', ['-p', join(home, rcFile, '..')]);
      writeFileSync(join(home, rcFile), body ?? RC_BODY);

      const env = await resolveShellEnv(run, { env: baseEnv(), shell: shell! });

      expect(env).not.toBeNull();
      expect(env!['PATH']!.split(':')[0]).toBe(join(home, 'rcbin'));
      expect(env!['MULTI']).toBe('first\nsecond');
      expect(env!['SAW_FLAG']).toBe('1');
      expect(env!['FORKLIFT_RESOLVING_ENVIRONMENT']).toBeUndefined();
      expect(env!['SHLVL']).toBeUndefined();
    });
  }

  it('gives up on a hanging rc file', async () => {
    const shell = which('bash');
    if (!shell) return;
    writeFileSync(join(home, '.bash_profile'), 'sleep 30\n');
    const messages: string[] = [];
    const env = await resolveShellEnv(run, { env: baseEnv(), shell, timeoutMs: 500, log: (m) => messages.push(m) });
    expect(env).toBeNull();
    expect(messages.join('\n')).toContain('did not finish in time');
  });

  it('survives a missing shell', async () => {
    expect(await resolveShellEnv(run, { env: baseEnv(), shell: '/nonexistent/zsh' })).toBeNull();
  });
});
