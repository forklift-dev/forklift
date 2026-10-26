import type { GitToolInfo, GitToolKind, GitToolSetting } from '../../shared/settings';
import { t } from '../../shared/i18n';
import type { GitCli } from '../git/cli';
import type { Runner } from '../process/types';
import { findExecutable } from './which';

export type ToolKind = GitToolKind;

export interface ToolChoice {
  name: string;
  /** `-c key=value` pairs placed before the subcommand (used to define a tool on the fly). */
  configArgs: string[];
  /** configured: git config; detected/vscode: picked automatically; settings: Forklift's Preferences. */
  source: 'configured' | 'detected' | 'vscode' | 'settings';
}

export type AvailableTool = GitToolInfo;

const FROM_GIT_CONFIG: GitToolSetting = { mode: 'git-config' };
/** Name under which a custom command from Preferences is defined for one git invocation. */
export const CUSTOM_TOOL = 'forklift-custom';
const TOOL_VARIABLES = /\$(LOCAL|REMOTE|BASE|MERGED)\b/g;

const shellEscape = (text: string) => text.replace(/[\\"`$]/g, '\\$&');

/**
 * Builds the `difftool.<name>.cmd` string git runs through sh: every argument double-quoted with
 * shell metacharacters escaped, except the $LOCAL/$REMOTE/$BASE/$MERGED variables git provides.
 */
export function gitToolCommand(command: string, args: readonly string[]): string {
  const quote = (arg: string) => {
    let quoted = '';
    let last = 0;
    for (const match of arg.matchAll(TOOL_VARIABLES)) {
      quoted += shellEscape(arg.slice(last, match.index)) + match[0];
      last = match.index + match[0].length;
    }
    return `"${quoted + shellEscape(arg.slice(last))}"`;
  };
  return [command, ...args].map(quote).join(' ');
}

export class DiffToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiffToolError';
  }
}

// Dedicated diff/merge applications first; editors that can also diff come last.
const GUI_PREFERENCE = [
  'meld', 'kdiff3', 'bc4', 'bc', 'bc3', 'p4merge', 'smerge', 'diffuse', 'tkdiff', 'kompare', 'xxdiff',
  'opendiff', 'winmerge', 'araxis', 'codecompare', 'deltawalker', 'diffmerge', 'ecmerge', 'examdiff',
  'guiffy', 'gvimdiff', 'vscode',
];
// Tools that need a terminal; started from the app they would hang waiting for one.
const TERMINAL_TOOLS = new Set(['vimdiff', 'vimdiff1', 'vimdiff2', 'vimdiff3', 'nvimdiff', 'emerge']);

/** Parses the "may be set to one of the following" section of `git difftool|mergetool --tool-help`. */
export function parseToolHelp(output: string): AvailableTool[] {
  const tools: AvailableTool[] = [];
  let inAvailable = false;
  for (const line of output.split('\n')) {
    if (/may be set to one of the following/.test(line)) {
      inAvailable = true;
      continue;
    }
    if (!inAvailable) continue;
    const match = /^\s+(\S+)\s*(.*)$/.exec(line);
    if (!match) break; // a blank line ends the section
    tools.push({ name: match[1]!, description: match[2] ?? '' });
  }
  return tools;
}

/** Picks a graphical tool: the configured one, else the preferred available one, else VS Code. */
export function chooseTool(
  kind: ToolKind,
  configured: string | null,
  available: readonly AvailableTool[],
  hasVsCode: boolean,
): ToolChoice | null {
  if (configured) return { name: configured, configArgs: [], source: 'configured' };

  // Newer git marks GUI tools; older git does not, so the known list decides there.
  const gui = available.filter(
    (tool) => !TERMINAL_TOOLS.has(tool.name) && (GUI_PREFERENCE.includes(tool.name) || /graphical/.test(tool.description)),
  );
  const rank = (name: string) => {
    const index = GUI_PREFERENCE.indexOf(name);
    return index < 0 ? GUI_PREFERENCE.length - 1 : index; // unknown GUI tools just before VS Code
  };
  const best = gui.sort((a, b) => rank(a.name) - rank(b.name))[0];
  if (best) return { name: best.name, configArgs: [], source: 'detected' };

  // Older git has no built-in vscode tool; define an equivalent one for this invocation.
  if (!hasVsCode) return null;
  const name = 'forklift-vscode';
  const configArgs =
    kind === 'diff'
      ? ['-c', `difftool.${name}.cmd=code --wait --diff "$LOCAL" "$REMOTE"`]
      : [
          '-c', `mergetool.${name}.cmd=code --wait --merge "$REMOTE" "$LOCAL" "$BASE" "$MERGED"`,
          // VS Code exits 0 either way; let git judge by whether MERGED was saved.
          '-c', `mergetool.${name}.trustExitCode=false`,
        ];
  return { name, configArgs, source: 'vscode' };
}

// Paths are passed to git literally: `*` or `?` in a file name must not act as a pattern.
const LITERAL_PATHS = { GIT_LITERAL_PATHSPECS: '1' };

/** Shows a file's changes in a diff tool and resolves conflicts in a merge tool, through git. */
export class DiffTools {
  private readonly open = new Set<string>();

  constructor(
    private readonly git: GitCli,
    private readonly runner: Runner,
  ) {}

  /** Resolves when the tool window is closed. `staged` compares index with HEAD, else worktree with index. */
  async diff(root: string, path: string, staged: boolean, setting: GitToolSetting = FROM_GIT_CONFIG): Promise<ToolChoice> {
    return this.exclusive(`diff:${staged}:${root}:${path}`, async () => {
      const tool = await this.pickTool(root, 'diff', setting);
      const args = [...tool.configArgs, 'difftool', '--no-prompt', `--tool=${tool.name}`, ...(staged ? ['--cached'] : []), '--', path];
      await this.git.exec(args, { cwd: root, readOnly: true, env: LITERAL_PATHS });
      return tool;
    });
  }

  /** Resolves when the merge tool is closed; git decides whether the conflict counts as resolved. */
  async merge(root: string, path: string, setting: GitToolSetting = FROM_GIT_CONFIG): Promise<ToolChoice> {
    return this.exclusive(`merge:${root}:${path}`, async () => {
      const tool = await this.pickTool(root, 'merge', setting);
      const args = [...tool.configArgs, 'mergetool', '--no-prompt', `--tool=${tool.name}`, '--', path];
      await this.git.exec(args, { cwd: root, env: LITERAL_PATHS });
      return tool;
    });
  }

  async pickTool(root: string, kind: ToolKind, setting: GitToolSetting = FROM_GIT_CONFIG): Promise<ToolChoice> {
    if (setting.mode === 'tool') return { name: setting.name, configArgs: [], source: 'settings' };
    if (setting.mode === 'custom') {
      if (!(await findExecutable(setting.command, await this.runner.environment()))) {
        throw new DiffToolError(t('{tool} tool command "{command}" was not found. Choose another one in Preferences → External tools.', {
          tool: kind === 'diff' ? t('tool|Diff') : t('tool|Merge'),
          command: setting.command,
        }));
      }
      const section = `${kind}tool.${CUSTOM_TOOL}`;
      const configArgs = ['-c', `${section}.cmd=${gitToolCommand(setting.command, setting.args)}`];
      if (kind === 'merge') configArgs.push('-c', `${section}.trustExitCode=${setting.trustExitCode}`);
      return { name: CUSTOM_TOOL, configArgs, source: 'settings' };
    }

    const configured = await this.configured(root, kind);
    const help = configured ? '' : (await this.git.exec([`${kind}tool`, '--tool-help'], { cwd: root, readOnly: true })).stdout;
    const hasVsCode = !configured && (await findExecutable('code', await this.runner.environment())) !== null;
    const choice = chooseTool(kind, configured, parseToolHelp(help), hasVsCode);
    if (!choice) {
      throw new DiffToolError(t('No graphical {kind} tool found. Install one (e.g. Meld or KDiff3) or set it with "git config --global {kind}.tool <name>".', { kind }));
    }
    return choice;
  }

  /** The tool git config names for `kind` (diff.tool falls back to merge.tool in git itself; GUI variants win). */
  async configured(cwd: string, kind: ToolKind): Promise<string | null> {
    const keys = kind === 'diff' ? ['diff.guitool', 'diff.tool', 'merge.guitool', 'merge.tool'] : ['merge.guitool', 'merge.tool'];
    for (const key of keys) {
      const { stdout } = await this.git.exec(['config', '--get', key], { cwd, readOnly: true, allowedExitCodes: [1] });
      if (stdout.trim()) return stdout.trim();
    }
    return null;
  }

  /** Tools git can run on this machine (installed), terminal-only ones excluded. */
  async available(cwd: string, kind: ToolKind): Promise<GitToolInfo[]> {
    const { stdout } = await this.git.exec([`${kind}tool`, '--tool-help'], { cwd, readOnly: true });
    return parseToolHelp(stdout).filter((tool) => !TERMINAL_TOOLS.has(tool.name));
  }

  private async exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
    if (this.open.has(key)) throw new DiffToolError(t('This file is already open in the external tool'));
    this.open.add(key);
    try {
      return await action();
    } finally {
      this.open.delete(key);
    }
  }
}
