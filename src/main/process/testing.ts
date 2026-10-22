// Test double for ProcessRunner: same spawn core as the process host, minus the utilityProcess,
// so code built on Runner can be tested against real programs under Vitest.
import { launchProcess, runProcess } from '../../process-host/spawn';
import type { Env } from '../../shared/process';
import { sanitizeEnv } from './env';
import { ProcessError, type Runner } from './types';

let nextId = 1;

async function settle<T>(result: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  try {
    const value = await result;
    if (signal?.aborted) throw signal.reason;
    return value;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const { message, code } = error as { message: string; code?: string };
    throw new ProcessError(message, code);
  }
}

export function directRunner(baseEnv: Env = sanitizeEnv(process.env)): Runner {
  return {
    async run(command, args, options = {}) {
      options.signal?.throwIfAborted();
      const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
      const streaming = Boolean(options.onStdout || options.onStderr);
      const handle = runProcess(
        {
          type: 'run',
          id: nextId++,
          command,
          args: [...args],
          cwd: options.cwd,
          env: options.replaceEnv ? sanitizeEnv(options.env ?? {}) : { ...baseEnv, ...options.env },
          input: typeof options.input === 'string' ? new TextEncoder().encode(options.input) : options.input,
          timeoutMs: options.timeoutMs,
          maxOutputBytes: options.maxOutputBytes,
          streamOutput: streaming,
        },
        streaming
          ? (stream, chunk) => {
              const text = decoders[stream].decode(chunk, { stream: true });
              if (text) (stream === 'stdout' ? options.onStdout : options.onStderr)?.(text);
            }
          : undefined,
      );
      options.signal?.addEventListener('abort', () => handle.cancel(), { once: true });
      const { stdout, stderr, ...rest } = await settle(handle.result, options.signal);
      return { ...rest, stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr) };
    },

    async launch(command, args, options = {}) {
      options.signal?.throwIfAborted();
      const handle = launchProcess({
        type: 'launch',
        id: nextId++,
        command,
        args: [...args],
        cwd: options.cwd,
        env: { ...baseEnv, ...options.env },
        wait: options.wait ?? false,
        showConsole: options.showConsole,
      });
      options.signal?.addEventListener('abort', () => handle.cancel(), { once: true });
      return settle(handle.result, options.signal);
    },
  };
}
