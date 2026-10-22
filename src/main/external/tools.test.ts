import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveInsideRepo } from '../repoPaths';
import { directRunner } from '../process/testing';
import { ExternalToolError, ExternalTools } from './tools';
import { findExecutable } from './which';

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-tools-')));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeScript(dir: string, name: string, body: string, mode = 0o755) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body, { mode });
}

describe('findExecutable', () => {
  it('returns the first executable match in PATH and skips non-executable files', async () => {
    writeScript(join(root, 'a'), 'tool', '', 0o644);
    writeScript(join(root, 'b'), 'tool', '#!/bin/sh\n');
    expect(await findExecutable('tool', { PATH: `${join(root, 'a')}:${join(root, 'b')}` }, 'linux')).toBe(join(root, 'b', 'tool'));
    expect(await findExecutable('missing', { PATH: join(root, 'b') }, 'linux')).toBeNull();
  });

  it('tries PATHEXT extensions on Windows', async () => {
    writeScript(join(root, 'bin'), 'code.CMD', '');
    expect(await findExecutable('code', { PATH: join(root, 'bin'), PATHEXT: '.EXE;.CMD' }, 'win32')).toBe(join(root, 'bin', 'code.CMD'));
  });
});

describe('resolveInsideRepo', () => {
  beforeEach(() => {
    mkdirSync(join(root, 'repo', 'src'), { recursive: true });
    writeFileSync(join(root, 'repo', 'src', 'a.ts'), '');
    writeFileSync(join(root, 'secret.txt'), '');
    symlinkSync(join(root, 'secret.txt'), join(root, 'repo', 'link.txt'));
  });

  it('resolves paths inside the repository', async () => {
    expect(await resolveInsideRepo(join(root, 'repo'), 'src/a.ts')).toBe(join(root, 'repo', 'src', 'a.ts'));
  });

  it.each([
    ['../secret.txt', 'outside the repository'],
    ['link.txt', 'outside the repository'], // symlink pointing out
    ['/etc/passwd', 'relative to the repository'],
    ['src/missing.ts', 'does not exist'],
  ])('rejects %s', async (path, message) => {
    await expect(resolveInsideRepo(join(root, 'repo'), path)).rejects.toThrow(message);
  });
});

// Fake programs record their working directory and arguments, so we can see exactly what was launched.
describe.skipIf(process.platform === 'win32')('ExternalTools', () => {
  const recorder = (out: string) => `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "${out}"\n`;
  const recorded = async (file: string) => {
    for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 20));
    return readFileSync(file, 'utf8').trimEnd().split('\n');
  };
  const tools = (env: Record<string, string>, opened: string[] = []) =>
    new ExternalTools({
      runner: directRunner({ PATH: join(root, 'bin'), ...env }),
      platform: 'linux',
      openPath: async (path) => {
        opened.push(path);
        return '';
      },
    });

  it('opens a file at a line in the first editor found', async () => {
    writeScript(join(root, 'bin'), 'code', recorder(join(root, 'editor.out')));
    const via = await tools({}).openInEditor('/repo/a b.ts', 7, root);
    expect(via).toBe(join(root, 'bin', 'code'));
    expect(await recorded(join(root, 'editor.out'))).toEqual([root, '--goto', '/repo/a b.ts:7']);
  });

  it('falls back to the default application without an editor', async () => {
    const opened: string[] = [];
    expect(await tools({}, opened).openInEditor('/repo/a.ts')).toBe('default application');
    expect(opened).toEqual(['/repo/a.ts']);
  });

  it('opens $TERMINAL in the repository directory', async () => {
    writeScript(join(root, 'bin'), 'myterm', recorder(join(root, 'term.out')));
    await tools({ TERMINAL: 'myterm' }).openTerminal(root);
    expect(await recorded(join(root, 'term.out'))).toEqual([root]);
  });

  it('resolves x-terminal-emulator to the real terminal and passes its directory flag', async () => {
    writeScript(join(root, 'bin'), 'konsole', recorder(join(root, 'konsole.out')));
    symlinkSync(join(root, 'bin', 'konsole'), join(root, 'bin', 'x-terminal-emulator'));
    const via = await tools({}).openTerminal(root);
    expect(via).toBe(join(root, 'bin', 'x-terminal-emulator'));
    expect(await recorded(join(root, 'konsole.out'))).toEqual([root, '--workdir', root]);
  });

  it('explains how to fix a missing terminal', async () => {
    await expect(tools({}).openTerminal(root)).rejects.toThrow(ExternalToolError);
    await expect(tools({}).openTerminal(root)).rejects.toThrow('TERMINAL');
  });
});

describe.skipIf(process.platform === 'win32')('ExternalTools with settings', () => {
  const recorder = (out: string) => `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "${out}"\n`;
  const recorded = async (file: string) => {
    for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 20));
    return readFileSync(file, 'utf8').trimEnd().split('\n');
  };
  const tools = (env: Record<string, string> = {}) =>
    new ExternalTools({ runner: directRunner({ PATH: join(root, 'bin'), ...env }), platform: 'linux', openPath: async () => '' });

  it('runs a custom editor command with placeholders substituted per argument', async () => {
    writeScript(join(root, 'bin'), 'my editor', recorder(join(root, 'editor.out')));
    const setting = { mode: 'custom' as const, command: 'my editor', args: ['--line={line}', '{file}', '--dir', '{dir}', '$(touch pwned)'] };
    await tools().openInEditor('/repo/a b.ts', 4, root, setting);
    expect(await recorded(join(root, 'editor.out'))).toEqual([root, '--line=4', '/repo/a b.ts', '--dir', root, '$(touch pwned)']);
    expect(existsSync(join(root, 'pwned'))).toBe(false);
  });

  it('uses a chosen preset even when another editor comes first', async () => {
    writeScript(join(root, 'bin'), 'code', recorder(join(root, 'code.out')));
    writeScript(join(root, 'bin'), 'zed', recorder(join(root, 'zed.out')));
    await tools().openInEditor('/repo/a.ts', 2, root, { mode: 'preset', id: 'zed' });
    expect(await recorded(join(root, 'zed.out'))).toEqual([root, '/repo/a.ts:2']);
    expect(existsSync(join(root, 'code.out'))).toBe(false);
  });

  it('picks a terminal preset over $TERMINAL and passes its directory flag', async () => {
    writeScript(join(root, 'bin'), 'kitty', recorder(join(root, 'kitty.out')));
    writeScript(join(root, 'bin'), 'myterm', recorder(join(root, 'myterm.out')));
    await tools({ TERMINAL: 'myterm' }).openTerminal(root, { mode: 'preset', id: 'kitty' });
    expect(await recorded(join(root, 'kitty.out'))).toEqual([root, '--directory', root]);
  });

  it('explains missing or unknown programs and where to change them', async () => {
    await expect(tools().openInEditor('/a', 1, root, { mode: 'preset', id: 'zed' })).rejects.toThrow(/"zed" is not installed.*Preferences/);
    await expect(tools().openInEditor('/a', 1, root, { mode: 'preset', id: 'notepad' })).rejects.toThrow(/not supported/);
    await expect(tools().openTerminal(root, { mode: 'custom', command: 'nope', args: [] })).rejects.toThrow(/Terminal command "nope" was not found/);
  });

  it('reports which presets are installed', async () => {
    writeScript(join(root, 'bin'), 'zed', '');
    writeScript(join(root, 'bin'), 'kitty', '');
    const detected = await tools({ TERMINAL: 'myterm' }).detect();
    expect(detected.editors.find((e) => e.id === 'zed')).toEqual({ id: 'zed', path: join(root, 'bin', 'zed') });
    expect(detected.editors.find((e) => e.id === 'code')).toEqual({ id: 'code', path: null });
    expect(detected.terminals.find((t) => t.id === 'kitty')?.path).toBe(join(root, 'bin', 'kitty'));
    expect(detected.terminals.some((t) => t.id === 'myterm')).toBe(false);
  });
});
