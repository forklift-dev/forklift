import type { MouseEvent } from 'react';
import type { RemoteActivity, RepoData } from '../../../shared/state';

interface ToolbarProps {
  repo: RepoData | null;
  busy: boolean;
  onOpen(): void;
  onRefresh(): void;
  onClose(): void;
  onOpenTerminal(): void;
  onPreferences(): void;
  onStash(): void;
  onPop(): void;
  remote: RemoteActivity | null;
  /** Pull with the repository's default (merge or rebase). */
  onPull(): void;
  /** The Pull ▾ menu: fetch, pull with merge, pull with rebase. */
  onPullMenu(event: MouseEvent): void;
  onPush(): void;
  onCancelRemote(): void;
  undo: { undo: string | null; redo: string | null } | null;
  onUndo(): void;
  onRedo(): void;
}

const VERB = { fetch: 'Fetching', pull: 'Pulling', push: 'Pushing' } as const;

export function Toolbar(props: ToolbarProps) {
  const { repo, busy, onOpen, onRefresh, onClose, onOpenTerminal, onPreferences, onStash, onPop, remote, onPull, onPullMenu, onPush, onCancelRemote, undo, onUndo, onRedo } = props;
  const branch = repo?.branch;
  return (
    <header className="toolbar">
      <div className="toolbar-repo">
        <strong>{repo?.name ?? 'Forklift'}</strong>
        {branch && (
          <span className="branch">
            {branch.head ?? `detached at ${branch.oid?.slice(0, 7) ?? '?'}`}
            {branch.upstream && (
              <span className="ahead-behind" title={`Tracking ${branch.upstream}`}>
                ↑{branch.ahead} ↓{branch.behind}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="toolbar-actions">
        {busy && <span className="spinner" aria-label="Loading" />}
        <button type="button" className="icon-button" onClick={onUndo} disabled={busy || !repo || !undo?.undo} aria-label="Undo" title={undo?.undo ? `Undo ${undo.undo} (Ctrl+Z)` : 'Nothing to undo'}>
          <span className="codicon codicon-discard" aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={onRedo} disabled={busy || !repo || !undo?.redo} aria-label="Redo" title={undo?.redo ? `Redo ${undo.redo} (Ctrl+Shift+Z)` : 'Nothing to redo'}>
          <span className="codicon codicon-redo" aria-hidden="true" />
        </button>
        {remote ? (
          <span className="remote-activity" role="status">
            <span className="spinner" aria-hidden="true" />
            {VERB[remote.kind]}
            {remote.phase && ` · ${remote.phase}`}
            {remote.percent !== null && ` ${remote.percent}%`}
            <button type="button" onClick={onCancelRemote}>
              Cancel
            </button>
          </span>
        ) : (
          <span className="split-button">
            <button type="button" onClick={onPull} disabled={!repo || !repo.branch.head} title={repo?.pullRebase ? 'Pull (rebase)' : 'Pull (merge)'}>
              Pull
            </button>
            <button type="button" className="split-arrow" onClick={onPullMenu} disabled={!repo} aria-label="More pull options">
              <span className="codicon codicon-chevron-down" aria-hidden="true" />
            </button>
          </span>
        )}
        <button type="button" onClick={onPush} disabled={!repo || !repo.branch.head || Boolean(remote)} title="Push the current branch (a push cannot be undone)">
          Push
        </button>
        <button type="button" onClick={onOpen} disabled={busy}>
          Open…
        </button>
        <button type="button" onClick={onRefresh} disabled={busy || !repo}>
          Refresh
        </button>
        <button type="button" onClick={onStash} disabled={busy || !repo || repo.changes.length === 0} title="Stash all changes, untracked files included">
          Stash
        </button>
        <button type="button" onClick={onPop} disabled={busy || !repo || repo.stashes.length === 0} title={repo?.stashes[0] ? `Pop ${repo.stashes[0].message}` : 'No stashes'}>
          Pop
        </button>
        <button type="button" onClick={onOpenTerminal} disabled={!repo}>
          Terminal
        </button>
        <button type="button" onClick={onClose} disabled={busy || !repo}>
          Close
        </button>
        <button type="button" className="icon-button" onClick={onPreferences} title="Preferences (Ctrl+,)" aria-label="Preferences">
          <span className="codicon codicon-settings-gear" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
