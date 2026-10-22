import { basename } from 'node:path';
import type { Env } from '../../shared/process';

/**
 * An external program invocation. Placeholders ({file}, {line}, {dir}) are substituted inside
 * individual arguments only, never through a shell, so file names cannot inject commands.
 */
export interface ToolCommand {
  /** Preset id shown in Preferences; defaults to the command name. */
  id?: string;
  command: string;
  args: string[];
  /** Windows: the program needs a console window of its own (cmd.exe as a terminal). */
  showConsole?: boolean;
  /** A symlink to the real terminal (Debian's x-terminal-emulator): resolve it to pick the right flags. */
  alias?: boolean;
}

export type ToolVars = Partial<Record<'file' | 'line' | 'dir', string>>;

export function expandArgs(args: readonly string[], vars: ToolVars): string[] {
  return args.map((arg) => arg.replace(/\{(file|line|dir)\}/g, (match, key: keyof ToolVars) => vars[key] ?? match));
}

/** Editors that accept a `file:line` location, in order of preference. */
export const EDITORS: readonly ToolCommand[] = [
  { command: 'code', args: ['--goto', '{file}:{line}'] },
  { command: 'cursor', args: ['--goto', '{file}:{line}'] },
  { command: 'codium', args: ['--goto', '{file}:{line}'] },
  { command: 'zed', args: ['{file}:{line}'] },
  { command: 'subl', args: ['{file}:{line}'] },
];

/** Linux terminals and how each is told its working directory (the process cwd is set as well). */
const LINUX_TERMINALS: Record<string, string[]> = {
  konsole: ['--workdir', '{dir}'],
  ptyxis: ['--new-window', '--working-directory={dir}'],
  kgx: ['--working-directory={dir}'],
  'gnome-terminal': ['--working-directory={dir}'],
  'xfce4-terminal': ['--working-directory={dir}'],
  tilix: ['--working-directory={dir}'],
  kitty: ['--directory', '{dir}'],
  alacritty: ['--working-directory', '{dir}'],
  wezterm: ['start', '--cwd', '{dir}'],
  foot: ['--working-directory={dir}'],
  xterm: [],
};

const DESKTOP_TERMINALS: Array<[desktop: RegExp, terminals: string[]]> = [
  [/KDE/i, ['konsole']],
  // Ubuntu 25.10+ and Fedora ship Ptyxis; GNOME Console (kgx) before that; gnome-terminal is the classic one.
  [/GNOME|Unity|ubuntu/i, ['ptyxis', 'kgx', 'gnome-terminal']],
  [/XFCE/i, ['xfce4-terminal']],
];

export const presetId = (tool: ToolCommand) => tool.id ?? tool.command;

export function linuxTerminalCommand(name: string): ToolCommand {
  return { command: name, args: LINUX_TERMINALS[basename(name)] ?? [] };
}

/** Terminals that can be picked by name, in order of preference. */
export function terminalPresets(platform: NodeJS.Platform, env: Env): ToolCommand[] {
  if (platform === 'darwin') return [{ id: 'Terminal', command: 'open', args: ['-a', 'Terminal', '{dir}'] }];
  if (platform === 'win32') {
    return [
      { command: 'wt.exe', args: ['-d', '{dir}'] },
      { command: 'cmd.exe', args: [], showConsole: true },
    ];
  }

  const names: string[] = [];
  const desktop = env['XDG_CURRENT_DESKTOP'] ?? '';
  for (const [pattern, terminals] of DESKTOP_TERMINALS) if (pattern.test(desktop)) names.push(...terminals);
  names.push('x-terminal-emulator', ...Object.keys(LINUX_TERMINALS));
  return [...new Set(names)].map((name) => (name === 'x-terminal-emulator' ? { command: name, args: [], alias: true } : linuxTerminalCommand(name)));
}

/** Terminal candidates for the automatic choice, in order of preference. */
export function terminalCandidates(platform: NodeJS.Platform, env: Env): ToolCommand[] {
  // On Linux $TERMINAL is the user's explicit choice; its flags are unknown, so it only gets the cwd.
  const explicit = platform === 'linux' && env['TERMINAL'] ? [{ command: env['TERMINAL'], args: [] }] : [];
  return [...explicit, ...terminalPresets(platform, env)];
}
