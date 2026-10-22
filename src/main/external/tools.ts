import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Runner } from '../process/types';
import { EDITORS, expandArgs, linuxTerminalCommand, terminalCandidates, type ToolCommand, type ToolVars } from './commands';
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
  /** User-chosen commands (settings, later); defaults are detected when absent. */
  editor?: ToolCommand;
  terminal?: ToolCommand;
}

/** Opens files and folders in the user's external editor and terminal. Programs are detached. */
export class ExternalTools {
  private readonly platform: NodeJS.Platform;

  constructor(private readonly deps: ExternalToolsDeps) {
    this.platform = deps.platform ?? process.platform;
  }

  /** Returns what was used, e.g. "/usr/bin/code" or "default application". */
  async openInEditor(file: string, line = 1, cwd?: string): Promise<string> {
    const vars = { file, line: String(line), dir: cwd };
    const editor = this.deps.editor ? await this.find([this.deps.editor]) : await this.find(EDITORS);
    if (editor) return this.launch(editor, vars, cwd);

    const error = await this.deps.openPath(file);
    if (error) throw new ExternalToolError(`Could not open ${basename(file)}: ${error}`);
    return 'default application';
  }

  async openTerminal(dir: string): Promise<string> {
    const env = await this.deps.runner.environment();
    const terminal = await this.find(this.deps.terminal ? [this.deps.terminal] : terminalCandidates(this.platform, env));
    if (!terminal) {
      throw new ExternalToolError('No terminal emulator found. Set the TERMINAL environment variable to the one you use.');
    }
    return this.launch(terminal, { dir }, dir);
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
