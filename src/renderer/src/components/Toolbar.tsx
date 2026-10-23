import type { RepoData } from '../../../shared/state';

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
}

export function Toolbar({ repo, busy, onOpen, onRefresh, onClose, onOpenTerminal, onPreferences, onStash, onPop }: ToolbarProps) {
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
