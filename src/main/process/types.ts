// ProcessRunner's public types, kept free of Electron imports so tests and pure modules can use them.
import type { Env, LaunchResult, RunResult } from '../../shared/process';

export interface RunOptions {
  cwd?: string;
  /** Added on top of the base environment (see ProcessRunner.setBaseEnv). */
  env?: Env;
  /** Use `env` as the complete environment instead of extending the base one. */
  replaceEnv?: boolean;
  input?: string | Uint8Array;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  /** Decoded output chunks as they arrive, e.g. for `git fetch --progress`. */
  onStdout?(text: string): void;
  onStderr?(text: string): void;
}

export interface LaunchOptions {
  cwd?: string;
  env?: Env;
  /** Resolve only when the program exits (diff/merge tools). Default: detach immediately. */
  wait?: boolean;
  signal?: AbortSignal;
  /** Windows: show a console window (for terminals). */
  showConsole?: boolean;
}

export interface TextRunResult extends Omit<RunResult, 'stdout' | 'stderr'> {
  stdout: string;
  stderr: string;
}

/** The part of ProcessRunner that callers depend on; tests substitute a direct implementation. */
export interface Runner {
  run(command: string, args: readonly string[], options?: RunOptions): Promise<TextRunResult>;
  launch(command: string, args: readonly string[], options?: LaunchOptions): Promise<LaunchResult>;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}
