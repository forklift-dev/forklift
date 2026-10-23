import type { Env } from '../../shared/process';
import { createLineSplitter } from '../process/lines';
import { ProcessError, type Runner } from '../process/types';

/** Oldest git we support: Debian 11's. Ubuntu 22.04 ships 2.34, macOS (Apple Git) 2.39. */
export const MIN_GIT_VERSION = '2.30.0';

export interface GitCliOptions {
  cwd: string;
  /** Never takes index.lock, so it cannot collide with the user's own git (GIT_OPTIONAL_LOCKS=0). */
  readOnly?: boolean;
  /** Exit codes that are answers rather than failures, e.g. 1 for `diff --quiet`. */
  allowedExitCodes?: number[];
  env?: Env;
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdoutLine?(line: string): void;
  /** Progress (`--progress`) and most diagnostics arrive here. */
  onStderrLine?(line: string): void;
}

export interface GitCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class GitCliError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
    /** Process-level error code, e.g. ENOENT when git is not installed. */
    readonly code?: string,
    /** Hooks and some commands report on stdout. */
    readonly stdout = '',
  ) {
    super(message);
    this.name = 'GitCliError';
  }
}

// Non-interactive by default: nothing may wait for a terminal or an editor nobody sees.
const GIT_ENV: Env = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  // Commands that would open an editor keep the prepared message (or abort on an empty one) instead of hanging.
  GIT_EDITOR: ':',
  // English messages so output can be matched. LANGUAGE (not LC_ALL=C) keeps the user's charset:
  // hooks running Python or Perl in the C locale break on UTF-8.
  LANGUAGE: 'en_US:en',
};

/** Told about every finished git run (the operation log). */
export type GitRunObserver = (run: { args: readonly string[]; cwd: string; readOnly: boolean; durationMs: number; exitCode: number | null; ok: boolean; stdout: string; stderr: string }) => void;

export class GitCli {
  constructor(
    private readonly runner: Runner,
    /** The git program; a function is asked on every call, so a changed setting applies at once. */
    private readonly gitExecutable: string | (() => string) = 'git',
    private readonly observer?: GitRunObserver,
  ) {}

  get executable(): string {
    return typeof this.gitExecutable === 'function' ? this.gitExecutable() : this.gitExecutable;
  }

  async exec(args: readonly string[], options: GitCliOptions): Promise<GitCliResult> {
    if (!this.observer) return this.run(args, options);
    const start = performance.now();
    const report = (exitCode: number | null, ok: boolean, stdout: string, stderr: string) =>
      this.observer!({ args, cwd: options.cwd, readOnly: Boolean(options.readOnly), durationMs: performance.now() - start, exitCode, ok, stdout, stderr });
    try {
      const result = await this.run(args, options);
      report(result.exitCode, true, result.stdout, result.stderr);
      return result;
    } catch (error) {
      if (error instanceof GitCliError) report(error.exitCode, false, error.stdout, error.stderr || error.message);
      else report(null, false, '', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async run(args: readonly string[], options: GitCliOptions): Promise<GitCliResult> {
    const stdoutLines = options.onStdoutLine && createLineSplitter(options.onStdoutLine);
    const stderrLines = options.onStderrLine && createLineSplitter(options.onStderrLine);

    const executable = this.executable;
    let result;
    try {
      result = await this.runner.run(executable, args, {
        cwd: options.cwd,
        env: { ...GIT_ENV, ...(options.readOnly && { GIT_OPTIONAL_LOCKS: '0' }), ...options.env },
        input: options.input,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        onStdout: stdoutLines?.push,
        onStderr: stderrLines?.push,
      });
    } catch (error) {
      if (error instanceof ProcessError) {
        const message = error.code === 'ENOENT' ? `git executable "${executable}" was not found` : error.message;
        throw new GitCliError(message, args, null, '', error.code);
      }
      throw error; // AbortError and the like pass through unchanged
    } finally {
      stdoutLines?.flush();
      stderrLines?.flush();
    }

    const command = `git ${args.join(' ')}`;
    if (result.timedOut) throw new GitCliError(`${command} timed out`, args, result.code, result.stderr);
    if (result.code === null) throw new GitCliError(`${command} was terminated (${result.signal})`, args, null, result.stderr);
    if (result.code !== 0 && !options.allowedExitCodes?.includes(result.code)) {
      throw new GitCliError(describeFailure(command, result.code, result.stderr), args, result.code, result.stderr, undefined, result.stdout);
    }
    return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr };
  }

  /** Installed git version, or null when git is missing or unusable. */
  async version(): Promise<string | null> {
    try {
      const { stdout } = await this.exec(['--version'], { cwd: process.cwd(), timeoutMs: 10_000 });
      return parseGitVersion(stdout);
    } catch {
      return null;
    }
  }
}

/** Uses git's own "fatal:"/"error:" line when there is one: it is what users can act on. */
function describeFailure(command: string, exitCode: number, stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim());
  const reason = lines.find((line) => /^(fatal|error):/.test(line)) ?? lines.findLast((line) => line.length > 0);
  return reason ? `${command} failed: ${reason}` : `${command} failed with exit code ${exitCode}`;
}

/** "git version 2.47.1.windows.2" → "2.47.1"; also handles "2.39.5 (Apple Git-154)". */
export function parseGitVersion(output: string): string | null {
  return /git version (\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

export function isVersionAtLeast(version: string, minimum: string): boolean {
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}
