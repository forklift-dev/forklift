import { utilityProcess, type UtilityProcess, type WebContents } from 'electron';
// oxlint-disable-next-line import/default -- virtual module: electron-vite bundles the entry and exports its path
import hostPath from '../../pty-host/index?modulePath';
import { TERMINAL_EVENT_CHANNEL, type PtyEvent, type PtyRequest, type TerminalEvent } from '../../shared/terminal';

export interface TerminalOptions {
  cwd: string;
  /** Shell program; the platform's default when empty. */
  shell: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

interface Session {
  owner: WebContents;
  repo: string;
}

/** The user's shell for the platform: $SHELL (or bash/sh), PowerShell or cmd on Windows. */
export function defaultShell(env: Record<string, string>, platform: NodeJS.Platform = process.platform): { shell: string; args: string[] } {
  if (platform === 'win32') return { shell: env['COMSPEC'] ?? 'powershell.exe', args: [] };
  // macOS terminals start login shells (profile read); Linux terminals start interactive ones.
  return { shell: env['SHELL'] || '/bin/bash', args: platform === 'darwin' ? ['-l'] : [] };
}

/**
 * Embedded terminals. Shells run under node-pty in a utilityProcess (the pty host); their output goes to
 * the window that opened them, input comes back from it. Each terminal belongs to a window and a repository
 * and ends with either.
 */
export class TerminalService {
  private host: UtilityProcess | null = null;
  private readonly sessions = new Map<number, Session>();
  private readonly pending = new Map<number, { resolve(pid: number): void; reject(error: Error): void }>();
  private nextId = 1;

  async create(owner: WebContents, repo: string, options: TerminalOptions): Promise<number> {
    const id = this.nextId++;
    const { shell, args } = options.shell ? { shell: options.shell, args: [] } : defaultShell(options.env);
    this.sessions.set(id, { owner, repo });
    if (!this.watched.has(owner.id)) this.watch(owner);
    const created = new Promise<number>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.send({
      type: 'create',
      id,
      shell,
      args,
      cwd: options.cwd,
      env: { ...options.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Forklift' },
      cols: options.cols,
      rows: options.rows,
    });
    try {
      await created;
    } catch (error) {
      this.sessions.delete(id);
      throw error;
    }
    return id;
  }

  /** Input from the window that owns the terminal (others are ignored). */
  write(owner: WebContents, id: number, data: string): void {
    if (this.sessions.get(id)?.owner === owner) this.send({ type: 'write', id, data });
  }

  resize(owner: WebContents, id: number, cols: number, rows: number): void {
    if (this.sessions.get(id)?.owner === owner) this.send({ type: 'resize', id, cols, rows });
  }

  kill(owner: WebContents | null, id: number): void {
    const session = this.sessions.get(id);
    if (!session || (owner && session.owner !== owner)) return;
    this.sessions.delete(id);
    this.send({ type: 'kill', id });
  }

  /** A closed tab takes its terminals along. */
  closeRepo(repo: string): void {
    for (const [id, session] of this.sessions) if (session.repo === repo) this.kill(null, id);
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.kill(null, id);
    this.host?.kill();
    this.host = null;
  }

  private readonly watched = new Set<number>();

  private watch(owner: WebContents) {
    this.watched.add(owner.id);
    owner.once('destroyed', () => {
      this.watched.delete(owner.id);
      for (const [id, session] of this.sessions) if (session.owner === owner) this.kill(null, id);
    });
  }

  private send(request: PtyRequest) {
    this.ensureHost().postMessage(request);
  }

  private ensureHost(): UtilityProcess {
    if (this.host) return this.host;
    const host = utilityProcess.fork(hostPath, [], { serviceName: 'Forklift Terminal Host' });
    host.on('message', (event: PtyEvent) => this.onEvent(event));
    host.on('exit', () => {
      if (this.host !== host) return;
      this.host = null;
      // Every shell went with the host: tell their windows.
      for (const [id, session] of this.sessions) this.emit(session, { type: 'exit', id, exitCode: -1 });
      this.sessions.clear();
      for (const waiter of this.pending.values()) waiter.reject(new Error('The terminal host stopped'));
      this.pending.clear();
    });
    this.host = host;
    return host;
  }

  private onEvent(event: PtyEvent) {
    if (event.type === 'created') {
      this.pending.get(event.id)?.resolve(event.pid);
      this.pending.delete(event.id);
      return;
    }
    if (event.type === 'error') {
      this.pending.get(event.id)?.reject(new Error(`Could not start the shell: ${event.message}`));
      this.pending.delete(event.id);
      return;
    }
    const session = this.sessions.get(event.id);
    if (!session) return;
    if (event.type === 'exit') this.sessions.delete(event.id);
    this.emit(session, event);
  }

  private emit(session: Session, event: TerminalEvent) {
    if (!session.owner.isDestroyed()) session.owner.send(TERMINAL_EVENT_CHANNEL, event);
  }
}
