import { useState, useTransition } from 'react';
import type { GitCliInfo, RepoData } from '../../shared/state';
import { invoke } from './api';
import { RepoWorkspace } from './components/RepoWorkspace';
import { Toolbar } from './components/Toolbar';
import { useAppState } from './state';

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

export type RunAction = (action: () => Promise<unknown>) => void;

export function App() {
  const repo = useAppState((s) => s.repo);
  const gitCli = useAppState((s) => s.app.gitCli);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const reportError = (error: unknown) => setActionError(error instanceof Error ? error.message : String(error));

  // Short commands: the UI shows a busy state until they finish.
  const run: RunAction = (action) =>
    startTransition(async () => {
      setActionError(null);
      try {
        await action();
      } catch (error) {
        reportError(error);
      }
    });

  // External tool windows can stay open for minutes; they must not put the UI into a busy state.
  const runInBackground: RunAction = (action) => {
    setActionError(null);
    action().catch(reportError);
  };

  const openRepo = () =>
    run(async () => {
      const path = await invoke('repo:pick');
      if (path) await invoke('repo:open', path);
    });

  const busy = isPending || repo.loading;
  const error = repo.error ?? actionError;
  const data: RepoData | null = repo.data;

  return (
    <div className="app">
      <Toolbar
        repo={data}
        busy={busy}
        onOpen={openRepo}
        onRefresh={() => run(() => invoke('repo:refresh'))}
        onClose={() => run(() => invoke('repo:close'))}
        onOpenTerminal={() => run(() => invoke('repo:openTerminal'))}
      />
      {error && <div className="error-banner">{error}</div>}
      {data ? (
        // Keyed by repository: selection and open diff belong to the repository they were made in.
        <RepoWorkspace key={data.root} data={data} run={run} runInBackground={runInBackground} />
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
