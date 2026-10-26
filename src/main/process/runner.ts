import { utilityProcess, type UtilityProcess } from 'electron';
// oxlint-disable-next-line import/default -- virtual module: electron-vite bundles the entry and returns its path
import hostPath from '../../process-host/index?modulePath';
import { terminateTree } from '../../process-host/kill';
import type { Env, HostError, HostEvent, HostRequest, LaunchResult } from '../../shared/process';
import { sanitizeEnv } from './env';
import { ProcessError, type LaunchOptions, type RunOptions, type Runner, type TextRunResult } from './types';

export { ProcessError, type LaunchOptions, type RunOptions, type Runner, type TextRunResult } from './types';

const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

interface PendingCall {
  resolve(event: Extract<HostEvent, { type: 'ran' | 'launched' }>): void;
  reject(error: Error): void;
  onOutput?(stream: 'stdout' | 'stderr', chunk: Uint8Array): void;
  /** Process tree to kill if the host dies; unset for detached launches, which must survive. */
  pid?: number;
  ownedByHost: boolean;
  command: string;
  args: readonly string[];
  cwd?: string;
  startedAt: number;
}

/** A command that is running now (for the status bar: what the app is doing, with a way to stop it). */
export interface RunningProcess {
  id: number;
  command: string;
  args: readonly string[];
  cwd?: string;
  /** Unix time in milliseconds. */
  startedAt: number;
}

/**
 * Runs external programs in a dedicated utilityProcess so spawning and output handling never
 * block the main process. The host starts on first use and restarts after a crash.
 */
export class ProcessRunner implements Runner {
  private host: UtilityProcess | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private baseEnv: Promise<Env> = Promise.resolve(sanitizeEnv(process.env));

  /**
   * Replaces the environment every process starts from. A promise (e.g. the login-shell env
   * being resolved) holds back subsequent calls until it settles; rejection falls back to process.env.
   */
  setBaseEnv(env: NodeJS.ProcessEnv | Env | Promise<NodeJS.ProcessEnv | Env>): void {
    this.baseEnv = Promise.resolve(env).then(sanitizeEnv, () => sanitizeEnv(process.env));
  }

  environment(): Promise<Env> {
    return this.baseEnv;
  }

  async run(command: string, args: readonly string[], options: RunOptions = {}): Promise<TextRunResult> {
    const env = options.replaceEnv ? sanitizeEnv(options.env ?? {}) : this.extendEnv(await this.baseEnv, options.env);
    const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
    const streaming = Boolean(options.onStdout || options.onStderr);
    const event = await this.call(
      (id) => ({
        type: 'run',
        id,
        command,
        args: [...args],
        cwd: options.cwd,
        env,
        input: typeof options.input === 'string' ? new TextEncoder().encode(options.input) : options.input,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        streamOutput: streaming,
        streamOnly: streaming && options.streamOnly,
      }),
      options.signal,
      streaming
        ? (stream, chunk) => {
            // stream: true keeps multi-byte characters split across chunks intact.
            const text = decoders[stream].decode(chunk, { stream: true });
            if (text) (stream === 'stdout' ? options.onStdout : options.onStderr)?.(text);
          }
        : undefined,
    );
    if (event.type !== 'ran') throw new ProcessError('Unexpected reply from process host');
    const { stdout, stderr, ...rest } = event.result;
    return { ...rest, stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr) };
  }

  async launch(command: string, args: readonly string[], options: LaunchOptions = {}): Promise<LaunchResult> {
    const env = this.extendEnv(await this.baseEnv, options.env);
    const event = await this.call(
      (id) => ({
        type: 'launch',
        id,
        command,
        args: [...args],
        cwd: options.cwd,
        env,
        wait: options.wait ?? false,
        showConsole: options.showConsole,
      }),
      options.signal,
    );
    if (event.type !== 'launched') throw new ProcessError('Unexpected reply from process host');
    return event.result;
  }

  /** Commands that run now (detached launches are not tracked once started). */
  running(): RunningProcess[] {
    return [...this.pending]
      .filter(([, call]) => call.ownedByHost)
      .map(([id, call]) => ({ id, command: call.command, args: call.args, cwd: call.cwd, startedAt: call.startedAt }));
  }

  /** Stops a running command as its caller's abort would; its caller sees it fail. */
  cancel(id: number): void {
    if (this.pending.get(id)?.ownedByHost) this.host?.postMessage({ type: 'cancel', id } satisfies HostRequest);
  }

  /** Cancels running commands and stops the host. Detached launches keep running. */
  dispose(): void {
    if (!this.host) return;
    this.host.postMessage({ type: 'shutdown' } satisfies HostRequest);
    this.host = null;
    this.terminateOwnedProcesses(); // in case the host is already unresponsive
    this.rejectAll(new ProcessError('Process runner was disposed'));
  }

  private terminateOwnedProcesses(): void {
    for (const call of this.pending.values()) {
      if (call.ownedByHost && call.pid !== undefined) terminateTree(call.pid);
    }
  }

  private extendEnv(base: Env, extra: Env | undefined): Env {
    return extra ? { ...base, ...extra } : base;
  }

  private call(
    build: (id: number) => Exclude<HostRequest, { type: 'cancel' | 'shutdown' }>,
    signal: AbortSignal | undefined,
    onOutput?: PendingCall['onOutput'],
  ): Promise<Extract<HostEvent, { type: 'ran' | 'launched' }>> {
    signal?.throwIfAborted();
    const host = this.ensureHost();
    const id = this.nextId++;
    const request = build(id);

    return new Promise((resolve, reject) => {
      const onAbort = () => host.postMessage({ type: 'cancel', id } satisfies HostRequest);
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      this.pending.set(id, {
        resolve: (event) => {
          cleanup();
          // Report a cancellation the caller asked for as an abort, like fetch() does.
          if (signal?.aborted) reject(signal.reason);
          else resolve(event);
        },
        reject: (error) => {
          cleanup();
          reject(signal?.aborted ? signal.reason : error);
        },
        onOutput,
        ownedByHost: request.type === 'run' || request.wait,
        command: request.command,
        args: request.args,
        cwd: request.cwd,
        startedAt: Date.now(),
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      host.postMessage(request);
    });
  }

  private ensureHost(): UtilityProcess {
    if (this.host) return this.host;
    const host = utilityProcess.fork(hostPath, [], { serviceName: 'Forklift Process Host' });
    host.on('message', (event: HostEvent) => this.onEvent(event));
    host.once('exit', (code) => {
      if (this.host !== host) return; // disposed on purpose
      this.host = null;
      // Commands run in their own process groups, so they would outlive the host as orphans.
      this.terminateOwnedProcesses();
      this.rejectAll(new ProcessError(`Process host exited unexpectedly (code ${code})`));
    });
    this.host = host;
    return host;
  }

  private onEvent(event: HostEvent): void {
    const call = this.pending.get(event.id);
    if (!call) return;
    switch (event.type) {
      case 'started':
        if (event.pid !== null) call.pid = event.pid;
        break;
      case 'output':
        call.onOutput?.(event.stream, event.chunk);
        break;
      case 'failed':
        this.pending.delete(event.id);
        call.reject(toProcessError(event.error));
        break;
      case 'ran':
      case 'launched':
        this.pending.delete(event.id);
        call.resolve(event);
        break;
    }
  }

  private rejectAll(error: Error): void {
    const calls = [...this.pending.values()];
    this.pending.clear();
    for (const call of calls) call.reject(error);
  }
}

function toProcessError(error: HostError): ProcessError {
  return new ProcessError(error.message, error.code);
}
