// Entry point of the pty host, an Electron utilityProcess forked by TerminalService (main). The native
// node-pty module lives here, so a crash or a stuck shell never takes the main process with it.
import { spawn, type IPty } from 'node-pty';
import type { PtyEvent, PtyRequest } from '../shared/terminal';

const port = process.parentPort;
const ptys = new Map<number, IPty>();

function send(event: PtyEvent) {
  port.postMessage(event);
}

port.on('message', ({ data }: { data: PtyRequest }) => {
  const request = data;
  switch (request.type) {
    case 'create': {
      try {
        const pty = spawn(request.shell, request.args, {
          name: 'xterm-256color',
          cols: request.cols,
          rows: request.rows,
          cwd: request.cwd,
          env: request.env,
        });
        ptys.set(request.id, pty);
        // Output is batched a little: a burst (a build log) arrives as a few messages, not thousands.
        let buffer = '';
        let timer: ReturnType<typeof setTimeout> | null = null;
        pty.onData((chunk) => {
          buffer += chunk;
          if (timer) return;
          timer = setTimeout(() => {
            timer = null;
            send({ type: 'data', id: request.id, data: buffer });
            buffer = '';
          }, 8);
        });
        pty.onExit(({ exitCode }) => {
          if (timer) clearTimeout(timer);
          if (buffer) send({ type: 'data', id: request.id, data: buffer });
          ptys.delete(request.id);
          send({ type: 'exit', id: request.id, exitCode });
        });
        send({ type: 'created', id: request.id, pid: pty.pid });
      } catch (error) {
        send({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
      }
      break;
    }
    case 'write':
      ptys.get(request.id)?.write(request.data);
      break;
    case 'resize':
      if (request.cols > 0 && request.rows > 0) ptys.get(request.id)?.resize(request.cols, request.rows);
      break;
    case 'kill':
      ptys.get(request.id)?.kill();
      break;
  }
});
