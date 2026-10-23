import { useEffect, useLayoutEffect, useRef, useState, useTransition, type DragEvent } from 'react';
import type { TabsState } from '../../shared/state';
import { invoke } from './api';
import { Preferences } from './components/preferences/Preferences';
import { RepositoriesScreen } from './components/RepositoriesScreen';
import { RepoWorkspace } from './components/RepoWorkspace';
import { TabBar } from './components/TabBar';
import { Toolbar } from './components/Toolbar';
import { useAppState } from './state';

/** Runs a command and reports failures in the banner; resolves to whether it succeeded. */
export type RunAction = (action: () => Promise<unknown>) => Promise<boolean>;

type Screen = 'repo' | 'repositories' | 'preferences';

/** Tab to switch to for Ctrl+Tab (+1), Ctrl+Shift+Tab (-1) or Ctrl+N (index N-1; Ctrl+9 is the last tab). */
function tabFor(tabs: TabsState, key: { step?: number; number?: number }): string | null {
  const list = tabs.tabs;
  if (list.length === 0) return null;
  if (key.number !== undefined) return (key.number === 9 ? list.at(-1) : list[key.number - 1])?.id ?? null;
  const current = list.findIndex((tab) => tab.id === tabs.activeId);
  return list[(current + key.step! + list.length) % list.length]!.id;
}

export function App() {
  const tabs = useAppState((s) => s.tabs);
  const repo = useAppState((s) => s.repo);
  const notices = useAppState((s) => s.app.notices);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('repo');
  const [dropping, setDropping] = useState(false);

  const reportError = (error: unknown) => setActionError(error instanceof Error ? error.message : String(error));

  // Short commands: the UI shows a busy state until they finish.
  const run: RunAction = (action) =>
    new Promise((resolve) =>
      startTransition(async () => {
        setActionError(null);
        try {
          await action();
          resolve(true);
        } catch (error) {
          reportError(error);
          resolve(false);
        }
      }),
    );

  // External tool windows can stay open for minutes; they must not put the UI into a busy state.
  const runInBackground: RunAction = async (action) => {
    setActionError(null);
    try {
      await action();
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

  const activate = (id: string) => {
    setScreen('repo');
    if (id !== tabs.activeId) void run(() => invoke('repo:activate', id));
  };
  const closeTab = (id: string) => void run(() => invoke('repo:close', id));

  // Shortcuts read the latest state through a ref; the listener is registered once.
  const shortcuts = useRef({ tabs, screen, activate, closeTab });
  useLayoutEffect(() => {
    shortcuts.current = { tabs, screen, activate, closeTab };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const { tabs: current, screen: shown, activate: switchTo, closeTab: close } = shortcuts.current;
      let handled = true;
      if (event.key === ',' && !event.shiftKey) setScreen('preferences');
      else if (event.key.toLowerCase() === 't' && !event.shiftKey) setScreen('repositories');
      else if (event.key.toLowerCase() === 'w' && !event.shiftKey) {
        if (shown === 'repo' && current.activeId) close(current.activeId);
        else if (current.tabs.length) setScreen('repo');
      } else if (event.key === 'Tab') {
        const id = tabFor(current, { step: event.shiftKey ? -1 : 1 });
        if (id) switchTo(id);
      } else if (/^[1-9]$/.test(event.key) && !event.shiftKey) {
        const id = tabFor(current, { number: Number(event.key) });
        if (id) switchTo(id);
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Capture phase: the diff editor would otherwise keep Ctrl+Tab and friends to itself.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // A folder dropped anywhere on the window opens as a repository.
  const onDrop = (event: DragEvent) => {
    setDropping(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    event.preventDefault();
    const path = window.forklift.pathForFile(file);
    if (path) void run(() => invoke('repo:open', path)).then((ok) => ok && setScreen('repo'));
  };

  const busy = isPending || repo.loading;
  const error = actionError;
  const data = repo.data;
  const activeId = tabs.activeId;
  const showRepositories = screen === 'repositories' || tabs.tabs.length === 0;

  return (
    <div
      className={`app${dropping ? ' dropping' : ''}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => event.currentTarget === event.target && setDropping(false)}
      onDrop={onDrop}
    >
      <TabBar
        tabs={tabs}
        managerOpen={showRepositories && screen !== 'preferences'}
        onActivate={activate}
        onClose={closeTab}
        onMove={(id, index) => void run(() => invoke('repo:move', id, index))}
        onNewTab={() => setScreen('repositories')}
      />
      <Toolbar
        repo={showRepositories ? null : data}
        busy={busy}
        onOpen={() => setScreen('repositories')}
        onRefresh={() => activeId && run(() => invoke('repo:refresh', activeId))}
        onClose={() => activeId && closeTab(activeId)}
        onOpenTerminal={() => activeId && run(() => invoke('repo:openTerminal', activeId))}
        onPreferences={() => setScreen('preferences')}
        onStash={() => activeId && run(() => invoke('stash:push', activeId, { message: '', includeUntracked: true, stagedOnly: false }))}
        onPop={() => activeId && data?.stashes[0] && run(() => invoke('stash:pop', activeId, data.stashes[0]!.sha))}
      />
      {notices.length > 0 && (
        <div className="error-banner notices" role="alert">
          {notices.join('\n')}
          <button type="button" onClick={() => void invoke('app:dismissNotices')}>
            Dismiss
          </button>
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      {screen === 'preferences' && <Preferences repo={data} onClose={() => setScreen('repo')} />}
      {screen !== 'preferences' && showRepositories && (
        <RepositoriesScreen
          run={run}
          onOpened={() => setScreen('repo')}
          onClose={tabs.tabs.length ? () => setScreen('repo') : undefined}
        />
      )}
      {/* Kept mounted under the other screens, so the selection and an open diff survive a visit there. */}
      <div className="app-main" hidden={screen === 'preferences' || showRepositories}>
        {data ? (
          // Keyed by repository: selection and open diff belong to the repository they were made in.
          <RepoWorkspace key={data.root} data={data} run={run} runInBackground={runInBackground} />
        ) : repo.loading ? (
          <main className="empty">
            <p>Loading {tabs.tabs.find((tab) => tab.id === activeId)?.name}…</p>
          </main>
        ) : (
          activeId &&
          repo.error && (
            <main className="empty repo-unavailable">
              <p>{repo.error}</p>
              <div className="empty-actions">
                <button type="button" onClick={() => void run(() => invoke('repo:refresh', activeId))}>
                  Try again
                </button>
                <button type="button" onClick={() => closeTab(activeId)}>
                  Remove tab
                </button>
              </div>
            </main>
          )
        )}
      </div>
    </div>
  );
}
