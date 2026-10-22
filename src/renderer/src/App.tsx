import { useState, useTransition } from 'react';
import { invoke } from './api';
import { ChangesPanel } from './components/ChangesPanel';
import { CommitList } from './components/CommitList';
import { Toolbar } from './components/Toolbar';
import { useAppState } from './state';
import type { GitCliInfo } from '../../shared/state';

function GitCliStatus({ info }: { info: GitCliInfo }) {
  if (!info.version) return <small className="git-version warning">git CLI not found in PATH</small>;
  if (!info.meetsMinimum) {
    return (
      <small className="git-version warning">
        git {info.version} is older than {info.minimumVersion}; some operations may fail
      </small>
    );
  }
  return <small className="git-version">git {info.version}</small>;
}

export function App() {
  const repo = useAppState((s) => s.repo);
  const gitCli = useAppState((s) => s.app.gitCli);
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

  // External tool windows can stay open for minutes; they must not put the UI into a busy state.
  const runInBackground = (action: () => Promise<unknown>) => {
    setActionError(null);
    action().catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error)));
  };

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
        onOpenTerminal={() => run(() => invoke('repo:openTerminal'))}
      />
      {error && <div className="error-banner">{error}</div>}
      {repo.data ? (
        <main className="workspace">
          <CommitList commits={repo.data.commits} />
          <ChangesPanel
            changes={repo.data.changes}
            onOpenFile={(path) => run(() => invoke('file:openInEditor', path))}
            onDiffFile={(path, staged) => runInBackground(() => invoke('file:externalDiff', path, staged))}
            onMergeFile={(path) => runInBackground(() => invoke('file:externalMerge', path))}
          />
        </main>
      ) : (
        <main className="empty">
          <p>No repository open</p>
          <button type="button" onClick={openRepo} disabled={busy}>
            Open repository…
          </button>
          {gitCli && <GitCliStatus info={gitCli} />}
        </main>
      )}
    </div>
  );
}
