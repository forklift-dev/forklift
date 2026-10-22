import type { RepoData } from '../../../shared/state';

interface ToolbarProps {
  repo: RepoData | null;
  busy: boolean;
  onOpen(): void;
  onRefresh(): void;
  onClose(): void;
  onOpenTerminal(): void;
  onPreferences(): void;
}

export function Toolbar({ repo, busy, onOpen, onRefresh, onClose, onOpenTerminal, onPreferences }: ToolbarProps) {
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
