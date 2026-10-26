import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n';
import type { LogEntry } from '../../../shared/log';
import { invoke } from '../api';
import { useAppState } from '../state';

// What a finished operation is called in its notification (translated when shown: the language can change).
const done = (title: string): string | undefined =>
  ({
    'remote:fetch': t('Fetched'),
    'remote:pull': t('Pulled'),
    'remote:push': t('Pushed'),
    'commit:create': t('Committed'),
    'stash:push': t('Changes stashed'),
    'stash:apply': t('Stash applied'),
    'stash:pop': t('Stash popped'),
    'stash:drop': t('Stash deleted'),
    'branch:create': t('Branch created'),
    'branch:checkout': t('Checked out'),
    'branch:rename': t('Branch renamed'),
    'branch:delete': t('Branch deleted'),
    'branch:merge': t('Merged'),
    'branch:rebase': t('Rebased'),
    'tag:create': t('Tag created'),
    'tag:delete': t('Tag deleted'),
    'commit:cherryPick': t('Cherry-picked'),
    'commit:revert': t('Reverted'),
    'commit:reset': t('done|Reset'),
    'rebase:interactive': t('Rebased'),
    'undo:undo': t('Undone'),
    'undo:redo': t('Redone'),
    'repo:clone': t('Cloned'),
    'repo:init': t('Repository created'),
    'profile:apply': t('Profile applied'),
    'remote:add': t('Remote added'),
    'remote:remove': t('Remote removed'),
    'submodule:add': t('Submodule added'),
    'gitflow:init': t('Gitflow set up'),
    'gitflow:start': t('Started'),
    'gitflow:finish': t('Finished'),
    'lfs:track': t('Tracked with LFS'),
    'lfs:untrack': t('No longer tracked with LFS'),
    'lfs:download': t('LFS objects downloaded'),
    'submodule:update': t('Submodules updated'),
    'submodule:sync': t('Submodule URLs synced'),
    'submodule:remove': t('Submodule removed'),
  } as Record<string, string>)[title];

interface Toast {
  id: number;
  text: string;
  detail: string;
}

const LIFETIME = 4000;
const baseName = (path: string | null) => (path ? (path.split(/[\\/]/).filter(Boolean).pop() ?? '') : '');

/** Notes about finished operations (bottom left) and the progress of a running fetch, pull, push or clone. */
export function Toasts({ onShowLog }: { onShowLog(id: number): void }) {
  const version = useAppState((s) => s.app.logVersion);
  const enabled = useAppState((s) => s.settings.values['general.notifications']);
  const remote = useAppState((s) => s.repo.remote ?? null);
  const repoName = useAppState((s) => s.repo.data?.name ?? '');
  const repo = useAppState((s) => s.repo.data?.root ?? null);
  const clone = useAppState((s) => s.app.clone);
  const pushHooks = useAppState((s) => (s.repo.hooks?.operation === 'push' ? s.repo.hooks : null));
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Entries below the cursor are settled and were looked at; null until the first read (old entries never toast).
  const cursor = useRef<number | null>(null);
  const seen = useRef(new Set<number>());

  useEffect(() => {
    let current = true;
    // Runs again on every change of the log (version).
    void invoke('log:entries', version > 0 ? (cursor.current ?? 0) : 0).then(({ entries }) => {
      if (!current) return;
      const first = cursor.current === null;
      const fresh: Toast[] = [];
      for (const entry of entries) {
        if (entry.kind !== 'operation' || entry.parent !== null || entry.status === 'running' || seen.current.has(entry.id)) continue;
        seen.current.add(entry.id);
        const text = first || entry.status !== 'ok' ? undefined : done(entry.title);
        if (text) fresh.push({ id: entry.id, text, detail: baseName(entry.repo) });
      }
      const running = entries.find((entry: LogEntry) => entry.kind === 'operation' && entry.status === 'running');
      cursor.current = running ? running.id - 1 : (entries.at(-1)?.id ?? cursor.current ?? 0);
      if (fresh.length && enabled) setToasts((list) => [...list, ...fresh].slice(-4));
    });
    return () => {
      current = false;
    };
  }, [version, enabled]);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts((list) => list.slice(1)), LIFETIME);
    return () => clearTimeout(timer);
  }, [toasts]);

  const progress = [
    remote && {
      key: 'remote',
      text: { fetch: t('Fetching {repo}', { repo: repoName }), pull: t('Pulling {repo}', { repo: repoName }), push: t('Pushing {repo}', { repo: repoName }), submodules: t('Updating submodules of {repo}', { repo: repoName }) }[remote.kind],
      // A pre-push hook runs before anything is sent: show what it prints.
      phase: pushHooks ? (pushHooks.output.length ? t('{hooks} hook: {output}', { hooks: pushHooks.hooks.join(', '), output: pushHooks.output.at(-1)! }) : t('{hooks} hook…', { hooks: pushHooks.hooks.join(', ') })) : remote.phase,
      percent: pushHooks ? null : remote.percent,
      cancel: () => repo && void invoke('remote:cancel', repo),
    },
    clone && { key: 'clone', text: t('Cloning {name}', { name: baseName(clone.target) }), phase: clone.phase, percent: clone.percent, cancel: () => void invoke('repo:cancelClone') },
  ].filter(Boolean) as Array<{ key: string; text: string; phase: string | null; percent: number | null; cancel(): void }>;

  if (!toasts.length && !progress.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {progress.map((item) => (
        <div key={item.key} className="toast progress" data-toast={item.key}>
          <span className="spinner" aria-hidden="true" />
          <span className="toast-text">
            {item.text}
            {item.phase && <span className="toast-detail"> · {item.phase}</span>}
            {item.percent !== null && <span className="toast-detail"> {item.percent}%</span>}
          </span>
          <button type="button" className="link-button" onClick={item.cancel}>
            {t('Cancel')}
          </button>
        </div>
      ))}
      {toasts.map((toast) => (
        <div key={toast.id} className="toast success" data-toast={toast.id}>
          <span className="codicon codicon-check" aria-hidden="true" />
          <span className="toast-text">
            {toast.text}
            {toast.detail && <span className="toast-detail"> · {toast.detail}</span>}
          </span>
          <button type="button" className="link-button" onClick={() => onShowLog(toast.id)}>
            {t('Log')}
          </button>
          <button type="button" className="icon-button" aria-label={t('Dismiss')} onClick={() => setToasts((list) => list.filter((other) => other.id !== toast.id))}>
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
