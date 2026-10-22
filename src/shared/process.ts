// Protocol between the main process (ProcessRunner) and the process host (utilityProcess).
// Messages travel via structured clone, so Uint8Array payloads need no extra encoding.

export type Env = Record<string, string>;

interface SpawnSpec {
  id: number;
  command: string;
  args: string[];
  cwd?: string;
  env?: Env;
}

/** Runs a process to completion, collecting (and optionally streaming) its output. */
export interface RunRequest extends SpawnSpec {
  type: 'run';
  input?: Uint8Array;
  timeoutMs?: number;
  /** Combined stdout + stderr cap; the process tree is killed once exceeded. */
  maxOutputBytes?: number;
  streamOutput: boolean;
}

/** Starts an external program (editor, terminal, diff/merge tool). */
export interface LaunchRequest extends SpawnSpec {
  type: 'launch';
  /** false: detach and forget, the program outlives the app; true: resolve when it exits. */
  wait: boolean;
  /** Windows: show a console window (terminals); hidden by default. */
  showConsole?: boolean;
}

export type HostRequest =
  | RunRequest
  | LaunchRequest
  | { type: 'cancel'; id: number }
  | { type: 'shutdown' };

export interface RunResult {
  /** Exit code, or null when the process was terminated by a signal. */
  code: number | null;
  signal: string | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  cancelled: boolean;
}

export interface LaunchResult {
  pid: number | null;
  /** Only for `wait: true`; null for detached launches. */
  code: number | null;
  signal: string | null;
}

export interface HostError {
  message: string;
  /** Node error code, e.g. ENOENT when the executable was not found. */
  code?: string;
}

export type HostEvent =
  | { type: 'started'; id: number; pid: number | null }
  | { type: 'output'; id: number; stream: 'stdout' | 'stderr'; chunk: Uint8Array }
  | { type: 'ran'; id: number; result: RunResult }
  | { type: 'launched'; id: number; result: LaunchResult }
  | { type: 'failed'; id: number; error: HostError };
