import { useEffect, useRef, useState } from 'react';
import { formatDate, t } from '../../../shared/i18n';
import type { LogEntry } from '../../../shared/log';
import { invoke } from '../api';
import { useAppState } from '../state';
import { useCommand } from '../useCommand';

const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
const baseName = (path: string | null) => (path ? (path.split(/[\\/]/).filter(Boolean).pop() ?? path) : '');

interface Group {
  entry: LogEntry;
  children: LogEntry[];
}

function Details({ entry }: { entry: LogEntry }) {
  const parts = [
    entry.error && [t('Error'), entry.error],
    entry.stderr?.trim() && [t('Output (stderr)'), entry.stderr.trim()],
    entry.stdout?.trim() && [t('Output (stdout)'), entry.stdout.trim()],
  ].filter(Boolean) as Array<[string, string]>;
  return (
    <div className="log-details">
      <p className="log-meta">
        {formatDate(entry.time, { dateStyle: 'medium', timeStyle: 'medium' })}
        {entry.repo && ` · ${entry.repo}`}
        {entry.exitCode !== undefined && ` · ${entry.exitCode === null ? t('exit code none (terminated)') : t('exit code {code}', { code: entry.exitCode })}`}
        {entry.readOnly && ` · ${t('read-only')}`}
      </p>
      {parts.map(([title, text]) => (
        <div key={title}>
          <h4>{title}</h4>
          <pre>{text}</pre>
        </div>
      ))}
      {!parts.length && <p className="empty-note">{t('No output')}</p>}
    </div>
  );
}

function Row({ entry, open, onToggle, nested }: { entry: LogEntry; open: boolean; onToggle(): void; nested?: boolean }) {
  return (
    <li className={`log-entry ${entry.kind} ${entry.status}${nested ? ' nested' : ''}`} data-log-id={entry.id}>
      <button type="button" className="log-row" aria-expanded={open} onClick={onToggle}>
        <span className={`codicon ${entry.status === 'error' ? 'codicon-error' : entry.status === 'running' ? 'codicon-loading codicon-modifier-spin' : entry.kind === 'git' ? 'codicon-terminal' : 'codicon-check'}`} aria-hidden="true" />
        <span className="log-time">{formatDate(entry.time, TIME)}</span>
        <span className="log-title">{entry.title}</span>
        <span className="log-repo">{entry.kind === 'operation' ? baseName(entry.repo) : ''}</span>
        <span className="log-duration">{entry.durationMs === null ? '…' : t('{ms} ms', { ms: entry.durationMs })}</span>
      </button>
      {open && <Details entry={entry} />}
    </li>
  );
}

/** Everything the app did, newest first: operations with the git commands they ran; export for a bug report. */
export function LogView({ focus, onClose }: { focus: number | null; onClose(): void }) {
  const version = useAppState((s) => s.app.logVersion);
  const page = useCommand('log:entries', [0], { reloadKey: version, keepPrevious: true });
  const entries = page.data?.entries ?? [];
  const dropped = page.data?.dropped ?? false;
  const [filter, setFilter] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [showReads, setShowReads] = useState(false);
  const [open, setOpen] = useState<Set<number>>(() => new Set(focus ? [focus] : []));
  const [status, setStatus] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const scrolled = useRef(false);

  useEffect(() => rootRef.current?.focus(), []);
  useEffect(() => {
    if (!focus || scrolled.current || !entries.length) return;
    scrolled.current = true;
    rootRef.current?.querySelector(`[data-log-id="${focus}"]`)?.scrollIntoView({ block: 'center' });
  }, [focus, entries.length]);

  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (entry: LogEntry) => {
    const text = `${entry.title} ${entry.repo ?? ''} ${entry.error ?? ''} ${entry.stderr ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  };
  const visibleGit = (entry: LogEntry) => showReads || !entry.readOnly || entry.status === 'error';
  const byParent = new Map<number, LogEntry[]>();
  for (const entry of entries) if (entry.parent !== null) byParent.set(entry.parent, [...(byParent.get(entry.parent) ?? []), entry]);
  const groups: Group[] = entries
    .filter((entry) => entry.parent === null || !entries.some((other) => other.id === entry.parent))
    .filter((entry) => entry.kind === 'operation' || visibleGit(entry))
    .map((entry) => ({ entry, children: (byParent.get(entry.id) ?? []).filter((child) => child.kind === 'operation' || visibleGit(child) || open.has(entry.id)) }))
    .filter(({ entry, children }) => (!errorsOnly || entry.status === 'error' || children.some((c) => c.status === 'error')) && (matches(entry) || children.some(matches)))
    .reverse();
  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section
      className="log-view"
      aria-label={t('Operation log')}
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="log-header">
        <h1>{t('Operation log')}</h1>
        <input type="search" placeholder={t('Filter')} aria-label={t('Filter the log')} value={filter} onChange={(event) => setFilter(event.target.value)} />
        <label className="checkbox-label">
          <input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} /> {t('Errors only')}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={showReads} onChange={(event) => setShowReads(event.target.checked)} /> {t('Read-only git commands')}
        </label>
        <span className="log-spacer" />
        {status && <span className="hint">{status}</span>}
        <button type="button" onClick={() => void invoke('log:export').then((path) => path && setStatus(t('Saved to {path}', { path })))}>
          {t('Export…')}
        </button>
        <button type="button" onClick={() => void invoke('log:clear')}>
          {t('Clear')}
        </button>
        <button type="button" aria-label={t('Close the log')} title={t('Close (Esc)')} onClick={onClose}>
          ✕
        </button>
      </header>
      <ul className="log-list">
        {groups.map(({ entry, children }) => (
          <li key={entry.id} className="log-group">
            <ul>
              <Row entry={entry} open={open.has(entry.id)} onToggle={() => toggle(entry.id)} />
              {(open.has(entry.id) || entry.status === 'error') &&
                children.map((child) => <Row key={child.id} entry={child} nested open={open.has(child.id)} onToggle={() => toggle(child.id)} />)}
            </ul>
          </li>
        ))}
        {!groups.length && <li className="empty-note">{entries.length ? t('Nothing matches') : t('Nothing logged yet')}</li>}
        {dropped && <li className="empty-note">{t('Older entries were dropped (the log keeps the last 3000).')}</li>}
      </ul>
    </section>
  );
}
