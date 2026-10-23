import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../../../shared/log';
import { invoke } from '../api';
import { useAppState } from '../state';

// What a finished operation is called in its notification.
const DONE: Record<string, string> = {
  'remote:fetch': 'Fetched',
  'remote:pull': 'Pulled',
  'remote:push': 'Pushed',
  'commit:create': 'Committed',
  'stash:push': 'Changes stashed',
  'stash:apply': 'Stash applied',
  'stash:pop': 'Stash popped',
  'stash:drop': 'Stash deleted',
  'branch:create': 'Branch created',
  'branch:checkout': 'Checked out',
  'branch:rename': 'Branch renamed',
  'branch:delete': 'Branch deleted',
  'branch:merge': 'Merged',
  'branch:rebase': 'Rebased',
  'tag:create': 'Tag created',
  'tag:delete': 'Tag deleted',
  'commit:cherryPick': 'Cherry-picked',
  'commit:revert': 'Reverted',
  'commit:reset': 'Reset',
  'rebase:interactive': 'Rebased',
  'undo:undo': 'Undone',
  'undo:redo': 'Redone',
  'repo:clone': 'Cloned',
  'repo:init': 'Repository created',
  'profile:apply': 'Profile applied',
  'remote:add': 'Remote added',
  'remote:remove': 'Remote removed',
  'submodule:add': 'Submodule added',
  'lfs:track': 'Tracked with LFS',
  'lfs:untrack': 'No longer tracked with LFS',
  'lfs:download': 'LFS objects downloaded',
  'submodule:update': 'Submodules updated',
  'submodule:sync': 'Submodule URLs synced',
  'submodule:remove': 'Submodule removed',
};

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
        if (!first && entry.status === 'ok' && DONE[entry.title]) fresh.push({ id: entry.id, text: DONE[entry.title]!, detail: baseName(entry.repo) });
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
      text: `${{ fetch: 'Fetching', pull: 'Pulling', push: 'Pushing', submodules: 'Updating submodules of' }[remote.kind]} ${repoName}`,
      phase: remote.phase,
      percent: remote.percent,
      cancel: () => repo && void invoke('remote:cancel', repo),
    },
    clone && { key: 'clone', text: `Cloning ${baseName(clone.target)}`, phase: clone.phase, percent: clone.percent, cancel: () => void invoke('repo:cancelClone') },
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
            Cancel
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
            Log
          </button>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setToasts((list) => list.filter((t) => t.id !== toast.id))}>
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
