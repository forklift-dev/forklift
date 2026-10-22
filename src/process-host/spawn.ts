import type { ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import crossSpawn from 'cross-spawn';
import type { HostError, LaunchRequest, LaunchResult, RunRequest, RunResult } from '../shared/process';
import { terminateTree } from './kill';

export interface ProcessHandle<T> {
  pid: number | null;
  result: Promise<T>;
  cancel(): void;
}

// POSIX: own process group, so the whole tree can be signalled (see kill.ts).
const OWN_PROCESS_GROUP = process.platform !== 'win32';

export class SpawnError extends Error implements HostError {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SpawnError';
  }

  toJSON(): HostError {
    return { message: this.message, ...(this.code && { code: this.code }) };
  }
}

function spawnFailed(command: string, error: NodeJS.ErrnoException): SpawnError {
  const reason = error.code === 'ENOENT' ? 'not found' : error.message;
  return new SpawnError(`Failed to start "${command}": ${reason}`, error.code);
}

/** Resolves on 'spawn', rejects on a spawn 'error' (ENOENT, EACCES, ...). */
function started(child: ChildProcess, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (error) => reject(spawnFailed(command, error)));
  });
}

export function runProcess(
  request: RunRequest,
  onOutput?: (stream: 'stdout' | 'stderr', chunk: Uint8Array) => void,
): ProcessHandle<RunResult> {
  const startedAt = performance.now();
  const child = crossSpawn(request.command, request.args, {
    cwd: request.cwd,
    env: request.env,
    stdio: [request.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    detached: OWN_PROCESS_GROUP,
    windowsHide: true,
  });

  const output = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
  let outputBytes = 0;
  let timedOut = false;
  let truncated = false;
  let cancelled = false;
  let terminating = false;

  const terminate = () => {
    if (terminating || child.pid === undefined) return;
    terminating = true;
    terminateTree(child.pid);
  };

  const collect = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
    if (truncated) return;
    const limit = request.maxOutputBytes;
    if (limit !== undefined && outputBytes + chunk.length > limit) {
      chunk = chunk.subarray(0, limit - outputBytes);
      truncated = true;
      terminate();
    }
    outputBytes += chunk.length;
    output[stream].push(chunk);
    if (onOutput && chunk.length > 0) onOutput(stream, chunk);
  };
  child.stdout?.on('data', collect('stdout'));
  child.stderr?.on('data', collect('stderr'));

  if (request.input && child.stdin) {
    // EPIPE when the process exits without reading its input is not our failure.
    child.stdin.on('error', () => {});
    child.stdin.end(request.input);
  }

  const timer =
    request.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          terminate();
        }, request.timeoutMs);

  const result = started(child, request.command).then(
    () =>
      new Promise<RunResult>((resolve) => {
        // 'close' (not 'exit') fires after stdout/stderr are drained.
        child.once('close', (code, signal) => {
          clearTimeout(timer);
          resolve({
            code,
            signal,
            stdout: Buffer.concat(output.stdout),
            stderr: Buffer.concat(output.stderr),
            durationMs: Math.round(performance.now() - startedAt),
            timedOut,
            truncated,
            cancelled,
          });
        });
      }),
    (error: unknown) => {
      clearTimeout(timer);
      throw error;
    },
  );

  return {
    pid: child.pid ?? null,
    result,
    cancel() {
      cancelled = true;
      terminate();
    },
  };
}

export function launchProcess(request: LaunchRequest): ProcessHandle<LaunchResult> {
  const child = crossSpawn(request.command, request.args, {
    cwd: request.cwd,
    env: request.env,
    stdio: 'ignore',
    // Detached programs must survive the app; waited-for ones get a group so they can be cancelled.
    detached: !request.wait || OWN_PROCESS_GROUP,
    windowsHide: !request.showConsole,
  });
  const pid = child.pid ?? null;

  const result = started(child, request.command).then(() => {
    if (!request.wait) {
      child.unref();
      return { pid, code: null, signal: null };
    }
    return new Promise<LaunchResult>((resolve) => {
      child.once('exit', (code, signal) => resolve({ pid, code, signal }));
    });
  });

  return {
    pid,
    result,
    cancel() {
      if (request.wait && pid !== null) terminateTree(pid);
    },
  };
}
