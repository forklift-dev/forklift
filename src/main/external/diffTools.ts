import type { GitCli } from '../git/cli';
import type { Runner } from '../process/types';
import { findExecutable } from './which';

export type ToolKind = 'diff' | 'merge';

export interface ToolChoice {
  name: string;
  /** `-c key=value` pairs placed before the subcommand (used to define a tool on the fly). */
  configArgs: string[];
  source: 'configured' | 'detected' | 'vscode';
}

export interface AvailableTool {
  name: string;
  description: string;
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
  async diff(root: string, path: string, staged: boolean): Promise<void> {
    await this.exclusive(`diff:${staged}:${root}:${path}`, async () => {
      const tool = await this.pickTool(root, 'diff');
      const args = [...tool.configArgs, 'difftool', '--no-prompt', `--tool=${tool.name}`, ...(staged ? ['--cached'] : []), '--', path];
      await this.git.exec(args, { cwd: root, readOnly: true, env: LITERAL_PATHS });
    });
  }

  /** Resolves when the merge tool is closed; git decides whether the conflict counts as resolved. */
  async merge(root: string, path: string): Promise<void> {
    await this.exclusive(`merge:${root}:${path}`, async () => {
      const tool = await this.pickTool(root, 'merge');
      const args = [...tool.configArgs, 'mergetool', '--no-prompt', `--tool=${tool.name}`, '--', path];
      await this.git.exec(args, { cwd: root, env: LITERAL_PATHS });
    });
  }

  async pickTool(root: string, kind: ToolKind): Promise<ToolChoice> {
    // diff.tool falls back to merge.tool in git itself; the GUI variants win when set.
    const keys = kind === 'diff' ? ['diff.guitool', 'diff.tool', 'merge.guitool', 'merge.tool'] : ['merge.guitool', 'merge.tool'];
    let configured: string | null = null;
    for (const key of keys) {
      const { stdout } = await this.git.exec(['config', '--get', key], { cwd: root, readOnly: true, allowedExitCodes: [1] });
      if ((configured = stdout.trim() || null)) break;
    }

    const help = configured ? '' : (await this.git.exec([`${kind}tool`, '--tool-help'], { cwd: root, readOnly: true })).stdout;
    const hasVsCode = !configured && (await findExecutable('code', await this.runner.environment())) !== null;
    const choice = chooseTool(kind, configured, parseToolHelp(help), hasVsCode);
    if (!choice) {
      throw new DiffToolError(
        `No graphical ${kind} tool found. Install one (e.g. Meld or KDiff3) or set it with ` +
          `"git config --global ${kind}.tool <name>".`,
      );
    }
    return choice;
  }

  private async exclusive(key: string, action: () => Promise<void>): Promise<void> {
    if (this.open.has(key)) throw new DiffToolError('This file is already open in the external tool');
    this.open.add(key);
    try {
      await action();
    } finally {
      this.open.delete(key);
    }
  }
}
