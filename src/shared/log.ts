// The operation log: what the app did (window commands) and every git program run inside each, for
// diagnosing problems. Kept in memory in main; windows read it on demand.

export interface LogEntry {
  id: number;
  kind: 'operation' | 'git';
  /** Unix time in milliseconds. */
  time: number;
  /** Operation: the command name (`remote:push`); git: the command line, credentials masked. */
  title: string;
  /** Repository root, when known. */
  repo: string | null;
  /** The operation a git run belongs to. */
  parent: number | null;
  /** Null while it runs. */
  durationMs: number | null;
  status: 'running' | 'ok' | 'error';
  /** Error message (operation), or git's exit code and output tails. */
  error?: string;
  exitCode?: number | null;
  readOnly?: boolean;
  stdout?: string;
  stderr?: string;
}

export interface LogPage {
  entries: LogEntry[];
  /** Entries before the oldest kept one were dropped. */
  dropped: boolean;
}

/** Masks passwords in URLs: https://ada:secret@host → https://ada:***@host. */
export function maskCredentials(text: string): string {
  return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:)[^\s/@]+@/gi, '$1***@');
}
