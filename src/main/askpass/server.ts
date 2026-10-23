import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AskPrompt } from '../../shared/state';
import { classifyPrompt, CREDENTIAL_ARG, SOCKET_ENV, TOKEN_ENV, ASKPASS_FLAG, type AskRequest } from './protocol';
import type { CredentialStore } from './credentials';

/** What the user answered; `remember`: keep the credentials git confirms (passwords only). */
export interface PromptAnswer {
  answer: string;
  remember: boolean;
}

export interface AskpassDeps {
  /** Shows a prompt to the user; resolves to the answer or null when cancelled. Never logged. */
  ask(prompt: AskPrompt): Promise<PromptAnswer | null>;
  /** Saved credentials, used as git's credential helper (after the user's own helpers). */
  credentials?: Pick<CredentialStore, 'get' | 'store' | 'erase'>;
  /** Command that starts this app in askpass mode: the executable and its leading arguments. */
  command: { executable: string; args: string[] };
  /** Folder for the wrapper script git runs (userData). */
  scriptDir: string;
  /** A prompt was withdrawn (its operation ended or git gave up): close its dialog. */
  onCancel?(id: number): void;
  platform?: NodeJS.Platform;
}

/** One network operation's right to ask: its env for git, and a way to end it (cancelling open prompts). */
export interface AskpassSession {
  env: Record<string, string>;
  /** Arguments before git's command: the app as a credential helper (`-c credential.helper=…`). */
  gitArgs?: string[];
  dispose(): void;
}

interface Session {
  repo: string | null;
  /** May show prompts; background work only uses saved credentials. */
  interactive: boolean;
  /** The user asked to remember what they typed in this run. */
  remember: boolean;
  /** git got the credentials from the store (so a store call just keeps them). */
  fromStore: boolean;
  cancel: Set<() => void>;
}

const MAX_REQUEST = 64 * 1024;
const shQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/** Answers git's and ssh's credential prompts with dialogs in the app (see T-024, «Дизайн askpass-моста»). */
export class AskpassServer {
  private server: Server | null = null;
  private socketPath = '';
  private socketDir: string | null = null;
  private script = '';
  private readonly sessions = new Map<string, Session>();
  private helper = '';
  private nextId = 1;

  constructor(private readonly deps: AskpassDeps) {}

  async start(): Promise<void> {
    const platform = this.deps.platform ?? process.platform;
    if (platform === 'win32') {
      this.socketPath = `\\\\.\\pipe\\forklift-askpass-${randomBytes(12).toString('hex')}`;
    } else {
      // A private folder: only this user may connect to the socket.
      const base = process.env['XDG_RUNTIME_DIR'] || tmpdir();
      this.socketDir = await mkdtemp(join(base, 'forklift-askpass-'));
      await chmod(this.socketDir, 0o700);
      this.socketPath = join(this.socketDir, 's');
    }
    this.server = createServer((socket) => this.handle(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.socketPath, () => resolve());
    });
    await mkdir(this.deps.scriptDir, { recursive: true });
    const { executable, args } = this.deps.command;
    if (platform === 'win32') {
      this.script = join(this.deps.scriptDir, 'forklift-askpass.cmd');
      const quoted = [executable, ...args, ASKPASS_FLAG].map((part) => `"${part}"`).join(' ');
      await writeFile(this.script, `@echo off\r\n${quoted} %*\r\n`);
      // git for Windows runs "!" helpers through its sh, which takes forward slashes.
      this.helper = `!"${this.script.replaceAll('\\', '/')}" ${CREDENTIAL_ARG}`;
    } else {
      this.script = join(this.deps.scriptDir, 'forklift-askpass.sh');
      await writeFile(this.script, `#!/bin/sh\nexec ${[executable, ...args, ASKPASS_FLAG].map(shQuote).join(' ')} "$@"\n`, { mode: 0o700 });
      await chmod(this.script, 0o700);
      this.helper = `!${shQuote(this.script)} ${CREDENTIAL_ARG}`;
    }
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) for (const cancel of session.cancel) cancel();
    this.sessions.clear();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    if (this.socketDir) await rm(this.socketDir, { recursive: true, force: true });
  }

  /**
   * Env for one git run that may ask for credentials on behalf of `repo`. Not `interactive` (background
   * fetches): saved credentials are used, but nobody is asked.
   */
  session(repo: string | null, { interactive = true }: { interactive?: boolean } = {}): AskpassSession {
    const token = randomBytes(24).toString('hex');
    const entry: Session = { repo, interactive, remember: false, fromStore: false, cancel: new Set<() => void>() };
    this.sessions.set(token, entry);
    return {
      env: {
        GIT_ASKPASS: this.script,
        SSH_ASKPASS: this.script,
        // OpenSSH 8.4+: use the askpass program even without a terminal check ("never" asks nothing).
        SSH_ASKPASS_REQUIRE: interactive ? 'force' : 'never',
        [SOCKET_ENV]: this.socketPath,
        [TOKEN_ENV]: token,
      },
      ...(this.deps.credentials && this.helper && { gitArgs: ['-c', `credential.helper=${this.helper}`] }),
      dispose: () => {
        for (const cancel of entry.cancel) cancel();
        this.sessions.delete(token);
      },
    };
  }

  private handle(socket: Socket): void {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST) return socket.destroy();
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      socket.removeAllListeners('data');
      void this.answer(socket, buffer.slice(0, end));
    });
    socket.on('error', () => {});
  }

  private async answer(socket: Socket, line: string): Promise<void> {
    const reply = (response: object): void => {
      socket.end(`${JSON.stringify(response)}\n`);
    };
    let request: AskRequest;
    try {
      request = JSON.parse(line) as AskRequest;
    } catch {
      return reply({ cancel: true });
    }
    const session = typeof request.token === 'string' ? this.sessions.get(request.token) : undefined;
    if (!session) return reply({ cancel: true });
    if ('credential' in request) return reply(await this.credential(session, request.credential).catch(() => ({ fields: {} })));
    if (typeof request.prompt !== 'string' || !session.interactive) return reply({ cancel: true });

    const prompt: AskPrompt = { id: this.nextId++, kind: classifyPrompt(request.prompt), prompt: request.prompt.slice(0, 2000), repo: session.repo };
    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true;
      reply({ cancel: true });
      this.deps.onCancel?.(prompt.id);
    };
    session.cancel.add(cancel);
    socket.once('close', cancel);
    const answer = await this.deps.ask(prompt).catch(() => null);
    session.cancel.delete(cancel);
    if (settled) return;
    settled = true;
    if (answer?.remember) session.remember = true;
    reply(answer === null ? { cancel: true } : { answer: answer.answer });
  }

  /** git's credential helper calls: get what is saved, keep what worked (when asked to), forget what failed. */
  private async credential(session: Session, { action, fields }: { action: string; fields: unknown }): Promise<{ fields: Record<string, string> }> {
    const store = this.deps.credentials;
    if (!store || typeof fields !== 'object' || fields === null) return { fields: {} };
    const clean = Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length <= 10_000));
    if (action === 'get') {
      const found = await store.get(clean);
      if (found) session.fromStore = true;
      return { fields: found ?? {} };
    }
    if (action === 'store' && (session.remember || session.fromStore)) await store.store(clean);
    if (action === 'erase') await store.erase(clean);
    return { fields: {} };
  }
}
