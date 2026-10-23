import { AsyncLocalStorage } from 'node:async_hooks';
import { maskCredentials, type LogEntry, type LogPage } from '../../shared/log';

const MAX_ENTRIES = 3000;
const MAX_OUTPUT = 8 * 1024;

const tail = (text: string) => (text.length > MAX_OUTPUT ? `…${text.slice(-MAX_OUTPUT)}` : text);

/** Window commands whose runs are not worth logging: frequent reads that change nothing. */
export const QUIET_COMMANDS = new Set([
  'history:rows',
  'history:locate',
  'history:search',
  'history:find',
  'commit:details',
  'commit:signature',
  'diff:file',
  'conflict:file',
  'file:history',
  'file:blame',
  'ref:validateName',
  'repo:checkTarget',
  'repo:createDefaults',
  'repo:files',
  'repo:activate',
  'repo:move',
  'repo:pick',
  'rebase:plan',
  'profile:current',
  'keys:list',
  'keys:publicKey',
  'git:identity',
  'tools:detect',
  'settings:browseExecutable',
  'log:entries',
  'log:export',
  'log:clear',
  'terminal:resize',
  'askpass:answer',
  'avatars:get',
  'submodule:list',
  'worktree:list',
  'app:dismissNotices',
]);

/**
 * In-memory ring of the last few thousand entries. Git runs started while an operation runs (in its async
 * context) are linked to it, so an error can be explained by the commands behind it.
 */
export class OperationLog {
  private readonly entries: LogEntry[] = [];
  private nextId = 1;
  private droppedAny = false;
  private readonly context = new AsyncLocalStorage<number>();

  constructor(private readonly changed: () => void = () => {}) {}

  /** Runs `work` as a logged operation; its id is passed on (e.g. to tie an error message to it). */
  async operation<T>(title: string, repo: string | null, work: (id: number) => Promise<T>): Promise<T> {
    const entry = this.add({ kind: 'operation', title, repo, parent: this.context.getStore() ?? null, status: 'running' });
    const start = performance.now();
    try {
      const value = await this.context.run(entry.id, () => work(entry.id));
      this.finish(entry, start, 'ok');
      return value;
    } catch (error) {
      this.finish(entry, start, 'error', { error: maskCredentials(error instanceof Error ? error.message : String(error)) });
      throw error;
    }
  }

  /** Records one git run (called by GitCli when it finishes). */
  git(run: { args: readonly string[]; cwd: string; readOnly: boolean; durationMs: number; exitCode: number | null; ok: boolean; stdout: string; stderr: string }): void {
    const entry = this.add({
      kind: 'git',
      title: maskCredentials(`git ${run.args.join(' ')}`),
      repo: run.cwd,
      parent: this.context.getStore() ?? null,
      status: run.ok ? 'ok' : 'error',
      readOnly: run.readOnly,
      exitCode: run.exitCode,
      // Output of reads can be large and is rarely interesting; failures keep theirs.
      ...((!run.readOnly || !run.ok) && { stdout: maskCredentials(tail(run.stdout)), stderr: maskCredentials(tail(run.stderr)) }),
    });
    entry.durationMs = Math.round(run.durationMs);
    entry.time -= entry.durationMs;
  }

  /** Entries after `afterId`, oldest first (at most `limit`, the newest ones). */
  page(afterId = 0, limit = 1000): LogPage {
    const entries = this.entries.filter((entry) => entry.id > afterId).slice(-limit);
    return { entries: entries.map((entry) => ({ ...entry })), dropped: this.droppedAny && afterId < (this.entries[0]?.id ?? 0) };
  }

  /** An entry and everything run inside it. */
  family(id: number): LogEntry[] {
    const ids = new Set([id]);
    return this.entries.filter((entry) => {
      if (ids.has(entry.id) || (entry.parent !== null && ids.has(entry.parent))) {
        ids.add(entry.id);
        return true;
      }
      return false;
    });
  }

  clear(): void {
    this.entries.length = 0;
    this.droppedAny = false;
    this.changed();
  }

  /** Plain text for a support request. */
  text(entries: readonly LogEntry[] = this.entries): string {
    return entries
      .map((entry) => {
        const head = `${new Date(entry.time).toISOString()} ${entry.kind === 'git' ? '  ' : ''}${entry.title}${entry.repo ? ` [${entry.repo}]` : ''} ${entry.status}${entry.durationMs !== null ? ` ${entry.durationMs} ms` : ''}${entry.exitCode !== undefined ? ` exit ${entry.exitCode}` : ''}`;
        const details = [entry.error, entry.stderr?.trim(), entry.status === 'error' ? entry.stdout?.trim() : ''].filter(Boolean).map((text) => text!.replace(/^/gm, '    '));
        return [head, ...details].join('\n');
      })
      .join('\n');
  }

  private add(fields: Omit<LogEntry, 'id' | 'time' | 'durationMs'>): LogEntry {
    const entry: LogEntry = { id: this.nextId++, time: Date.now(), durationMs: null, ...fields };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
      this.droppedAny = true;
    }
    this.changed();
    return entry;
  }

  private finish(entry: LogEntry, start: number, status: 'ok' | 'error', extra: Partial<LogEntry> = {}): void {
    Object.assign(entry, { status, durationMs: Math.round(performance.now() - start), ...extra });
    this.changed();
  }
}
