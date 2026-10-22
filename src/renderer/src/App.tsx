import { useState, useTransition } from 'react';
import { invoke } from './api';
import { ChangesPanel } from './components/ChangesPanel';
import { CommitList } from './components/CommitList';
import { Toolbar } from './components/Toolbar';
import { useAppState } from './state';

export function App() {
  const repo = useAppState((s) => s.repo);
  const gitVersion = useAppState((s) => s.app.gitVersion);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const run = (action: () => Promise<unknown>) =>
    startTransition(async () => {
      setActionError(null);
      try {
        await action();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      }
    });

  const openRepo = () =>
    run(async () => {
      const path = await invoke('repo:pick');
      if (path) await invoke('repo:open', path);
    });

  const busy = isPending || repo.loading;
  const error = repo.error ?? actionError;

  return (
    <div className="app">
      <Toolbar
        repo={repo.data}
        busy={busy}
        onOpen={openRepo}
        onRefresh={() => run(() => invoke('repo:refresh'))}
        onClose={() => run(() => invoke('repo:close'))}
      />
      {error && <div className="error-banner">{error}</div>}
      {repo.data ? (
        <main className="workspace">
          <CommitList commits={repo.data.commits} />
          <ChangesPanel changes={repo.data.changes} />
        </main>
      ) : (
        <main className="empty">
          <p>No repository open</p>
          <button type="button" onClick={openRepo} disabled={busy}>
            Open repository…
          </button>
          {gitVersion !== undefined && (
            <small className="git-version">{gitVersion ? `git ${gitVersion}` : 'git CLI not found in PATH'}</small>
          )}
        </main>
      )}
    </div>
  );
}
