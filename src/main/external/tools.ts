import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import type { AppToolSetting, DetectedProgram } from '../../shared/settings';
import type { Runner } from '../process/types';
import { EDITORS, expandArgs, linuxTerminalCommand, presetId, terminalCandidates, terminalPresets, type ToolCommand, type ToolVars } from './commands';
import { findExecutable } from './which';

export class ExternalToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalToolError';
  }
}

export interface ExternalToolsDeps {
  runner: Runner;
  platform?: NodeJS.Platform;
  /** Opens a file with the OS default application; Electron's shell.openPath in the app. */
  openPath(path: string): Promise<string>;
}

const AUTO: AppToolSetting = { mode: 'auto' };
const CHANGE_HINT = 'Choose another one in Preferences → External tools.';

/** Opens files and folders in the user's external editor and terminal. Programs are detached. */
export class ExternalTools {
  private readonly platform: NodeJS.Platform;

  constructor(private readonly deps: ExternalToolsDeps) {
    this.platform = deps.platform ?? process.platform;
  }

  /** Returns what was used, e.g. "/usr/bin/code" or "default application". */
  async openInEditor(file: string, line = 1, cwd?: string, setting: AppToolSetting = AUTO): Promise<string> {
    const vars = { file, line: String(line), dir: cwd };
    const editor = await this.resolve(setting, EDITORS, 'Editor');
    if (editor) return this.launch(editor, vars, cwd);

    const error = await this.deps.openPath(file);
    if (error) throw new ExternalToolError(`Could not open ${basename(file)}: ${error}`);
    return 'default application';
  }

  async openTerminal(dir: string, setting: AppToolSetting = AUTO): Promise<string> {
    const env = await this.deps.runner.environment();
    const terminal = await this.resolve(setting, terminalPresets(this.platform, env), 'Terminal', terminalCandidates(this.platform, env));
    if (!terminal) {
      throw new ExternalToolError('No terminal emulator found. Choose one in Preferences → External tools or set the TERMINAL environment variable.');
    }
    return this.launch(terminal, { dir }, dir);
  }

  /** Known editors and terminals with where they are installed, for the Preferences pickers. */
  async detect(): Promise<{ editors: DetectedProgram[]; terminals: DetectedProgram[] }> {
    const env = await this.deps.runner.environment();
    const locate = (tools: readonly ToolCommand[]) =>
      Promise.all(tools.map(async (tool) => ({ id: presetId(tool), path: await findExecutable(tool.command, env, this.platform) })));
    return { editors: await locate(EDITORS), terminals: await locate(terminalPresets(this.platform, env)) };
  }

  /** The program to run for a setting; null only for an automatic choice that found nothing. */
  private async resolve(
    setting: AppToolSetting,
    presets: readonly ToolCommand[],
    what: string,
    automatic: readonly ToolCommand[] = presets,
  ): Promise<ToolCommand | null> {
    if (setting.mode === 'custom') {
      const found = await this.find([{ command: setting.command, args: setting.args }]);
      if (!found) throw new ExternalToolError(`${what} command "${setting.command}" was not found. ${CHANGE_HINT}`);
      return found;
    }
    if (setting.mode === 'preset') {
      const preset = presets.find((tool) => presetId(tool) === setting.id);
      if (!preset) throw new ExternalToolError(`${what} "${setting.id}" is not supported on this system. ${CHANGE_HINT}`);
      const found = await this.find([preset]);
      if (!found) throw new ExternalToolError(`${what} "${setting.id}" is not installed (not found in PATH). ${CHANGE_HINT}`);
      return found;
    }
    return this.find(automatic);
  }

  /** First candidate whose executable exists, with its command replaced by the resolved path. */
  private async find(candidates: readonly ToolCommand[]): Promise<ToolCommand | null> {
    const env = await this.deps.runner.environment();
    for (const candidate of candidates) {
      const path = await findExecutable(candidate.command, env, this.platform);
      if (!path) continue;
      if (!candidate.alias) return { ...candidate, command: path };
      const real = await realpath(path).catch(() => path);
      return { ...candidate, command: path, args: linuxTerminalCommand(basename(real)).args };
    }
    return null;
  }

  private async launch(tool: ToolCommand, vars: ToolVars, cwd: string | undefined): Promise<string> {
    await this.deps.runner.launch(tool.command, expandArgs(tool.args, vars), { cwd, showConsole: tool.showConsole });
    return tool.command;
  }
}
