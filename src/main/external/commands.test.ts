import { describe, expect, it } from 'vitest';
import { expandArgs, terminalCandidates } from './commands';

describe('expandArgs', () => {
  it('substitutes placeholders inside single arguments', () => {
    expect(expandArgs(['--goto', '{file}:{line}'], { file: '/r/a.ts', line: '12' })).toEqual(['--goto', '/r/a.ts:12']);
  });

  it('keeps hostile file names as one inert argument', () => {
    const file = '/r/a b; rm -rf ~ $(whoami) "q"';
    expect(expandArgs(['{file}'], { file })).toEqual([file]);
  });

  it('leaves unknown or missing placeholders as they are', () => {
    expect(expandArgs(['{dir}', '{other}'], {})).toEqual(['{dir}', '{other}']);
  });
});

describe('terminalCandidates', () => {
  const commands = (env: Record<string, string>) => terminalCandidates('linux', env).map((c) => c.command);

  it('prefers $TERMINAL, then the desktop’s own terminal, then x-terminal-emulator', () => {
    expect(commands({ TERMINAL: 'wezterm', XDG_CURRENT_DESKTOP: 'KDE' }).slice(0, 3)).toEqual(['wezterm', 'konsole', 'x-terminal-emulator']);
    expect(commands({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }).slice(0, 4)).toEqual(['ptyxis', 'kgx', 'gnome-terminal', 'x-terminal-emulator']);
    expect(commands({}).slice(0, 2)).toEqual(['x-terminal-emulator', 'konsole']);
  });

  it('lists each terminal once, with its working-directory flag', () => {
    const list = terminalCandidates('linux', { XDG_CURRENT_DESKTOP: 'KDE' });
    expect(list.filter((c) => c.command === 'konsole')).toEqual([{ command: 'konsole', args: ['--workdir', '{dir}'] }]);
    expect(list.find((c) => c.command === 'x-terminal-emulator')).toEqual({ command: 'x-terminal-emulator', args: [], alias: true });
  });

  it('uses the platform terminals on macOS and Windows', () => {
    expect(terminalCandidates('darwin', {})).toEqual([{ command: 'open', args: ['-a', 'Terminal', '{dir}'] }]);
    expect(terminalCandidates('win32', {}).map((c) => c.command)).toEqual(['wt.exe', 'cmd.exe']);
  });
});
