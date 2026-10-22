// Entry point of the process host, an Electron utilityProcess forked by ProcessRunner (main).
// Spawning from here keeps fork/exec cost and output handling off the main process.
import type { HostEvent, HostRequest } from '../shared/process';
import { launchProcess, runProcess, SpawnError, type ProcessHandle } from './spawn';

const port = process.parentPort;
const active = new Map<number, ProcessHandle<unknown>>();

function send(event: HostEvent) {
  port.postMessage(event);
}

function fail(id: number, error: unknown) {
  const hostError =
    error instanceof SpawnError ? error.toJSON() : { message: error instanceof Error ? error.message : String(error) };
  send({ type: 'failed', id, error: hostError });
}

function track<T>(id: number, handle: ProcessHandle<T>, done: (result: T) => void) {
  active.set(id, handle);
  send({ type: 'started', id, pid: handle.pid });
  handle.result.then(done, (error: unknown) => fail(id, error)).finally(() => active.delete(id));
}

function dispatch(request: HostRequest) {
  switch (request.type) {
    case 'run': {
      const onOutput = request.streamOutput
        ? (stream: 'stdout' | 'stderr', chunk: Uint8Array) => send({ type: 'output', id: request.id, stream, chunk })
        : undefined;
      track(request.id, runProcess(request, onOutput), (result) => send({ type: 'ran', id: request.id, result }));
      break;
    }
    case 'launch':
      track(request.id, launchProcess(request), (result) => send({ type: 'launched', id: request.id, result }));
      break;
    case 'cancel':
      active.get(request.id)?.cancel();
      break;
    case 'shutdown':
      // Running commands are owned by the app; detached launches were never tracked and survive.
      for (const running of active.values()) running.cancel();
      process.exit(0);
  }
}

port.on('message', ({ data }: { data: HostRequest }) => {
  try {
    dispatch(data);
  } catch (error) {
    if ('id' in data) fail(data.id, error);
    else console.error('[process-host]', error);
  }
});

// One broken request must not take down every other running command.
process.on('uncaughtException', (error) => console.error('[process-host] uncaught', error));
process.on('unhandledRejection', (error) => console.error('[process-host] unhandled rejection', error));
