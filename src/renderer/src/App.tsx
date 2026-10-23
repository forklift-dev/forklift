import { useEffect, useState, useTransition, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { SettingsSection } from '../../shared/settings';
import type { TabsState } from '../../shared/state';
import { BUILTIN_THEMES } from '../../shared/themes';
import { invoke } from './api';
import { OPEN_COMMANDS_EVENT, startShortcuts, useCommandHandlers } from './commands';
import { CommandPalette } from './components/CommandPalette';
import type { NewRepoKind } from './components/NewRepoDialog';
import { Preferences } from './components/preferences/Preferences';
import { RepositoriesScreen } from './components/RepositoriesScreen';
import { RepoWorkspace } from './components/RepoWorkspace';
import { useContextMenu } from './components/ContextMenu';
import { PromptDialog } from './components/PromptDialog';
import { TabBar } from './components/TabBar';
import { TerminalPanel } from './components/TerminalPanel';
import { useRemoteActions } from './components/useRemoteActions';
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
  const prompts = useAppState((s) => s.app.prompts);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('repo');
  // Repositories whose terminal panel was opened (their shells live while the tab is open) and whether it shows.
  const [terminalRepos, setTerminalRepos] = useState<string[]>([]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(() => {
    try {
      return Number(localStorage.getItem('forklift.terminalHeight')) || 260;
    } catch {
      return 260;
    }
  });
  const toggleTerminal = () => {
    const id = tabs.activeId;
    if (!id) return;
    if (!terminalRepos.includes(id)) setTerminalRepos((current) => [...current, id]);
    setTerminalOpen((open) => !(open && terminalRepos.includes(id)));
  };
  const resizeTerminal = (event: ReactPointerEvent) => {
    const startY = event.clientY;
    const startHeight = terminalHeight;
    const move = (e: PointerEvent) => setTerminalHeight(Math.max(100, Math.min(window.innerHeight - 200, startHeight + startY - e.clientY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setTerminalHeight((height) => {
        try {
          localStorage.setItem('forklift.terminalHeight', String(height));
        } catch {
          // not kept: fine
        }
        return height;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [dropping, setDropping] = useState(false);
  const [palette, setPalette] = useState<string | null>(null);
  const [preferencesSection, setPreferencesSection] = useState<SettingsSection | undefined>(undefined);
  const [creating, setCreating] = useState<NewRepoKind | null>(null);
  const userThemes = useAppState((s) => s.app.userThemes.themes);

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

  const remoteActions = useRemoteActions(tabs.activeId, repo.data, run);

  const activate = (id: string) => {
    setScreen('repo');
    if (id !== tabs.activeId) void run(() => invoke('repo:activate', id));
  };
  const closeTab = (id: string) => void run(() => invoke('repo:close', id));

  const undoRedo = (redo: boolean) => {
    const labels = repo.undo;
    if (tabs.activeId && (redo ? labels?.redo : labels?.undo)) void run(() => invoke(redo ? 'undo:redo' : 'undo:undo', tabs.activeId!));
  };
  const canUndo = (redo: boolean) => screen === 'repo' && Boolean(tabs.activeId) && Boolean(redo ? repo.undo?.redo : repo.undo?.undo);
  const goToTab = (key: { step?: number; number?: number }) => {
    const id = tabFor(tabs, key);
    if (id) activate(id);
  };
  const openPreferences = (section?: SettingsSection) => {
    setPreferencesSection(section);
    setScreen('preferences');
  };
  const openCreate = (kind: NewRepoKind) => {
    setCreating(kind);
    setScreen('repositories');
  };

  const onRepo = () => screen === 'repo' && Boolean(repo.data);
  const tabCommands = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`tabs.select${i + 1}`, { run: () => goToTab({ number: i + 1 }), enabled: () => tabs.tabs.length > i }]),
  );
  const themeCommands = Object.fromEntries(
    [...BUILTIN_THEMES, ...userThemes].map((theme) => [
      `theme.use.${theme.id}`,
      { title: `Use the ${theme.name} theme`, category: 'View', run: () => void run(() => invoke('settings:update', { values: { 'ui.theme': theme.id } })) },
    ]),
  );
  useCommandHandlers({
    'palette.commands': { run: () => setPalette('') },
    'app.preferences': { run: () => openPreferences() },
    'app.keybindings': { run: () => openPreferences('keys') },
    'theme.choose': { run: () => openPreferences('ui') },
    'app.repositories': { run: () => setScreen('repositories') },
    'repo.clone': { run: () => openCreate('clone') },
    'repo.init': { run: () => openCreate('init') },
    'tabs.close': {
      run: () => {
        if (screen === 'repo' && tabs.activeId) closeTab(tabs.activeId);
        else if (tabs.tabs.length) setScreen('repo');
      },
    },
    'tabs.next': { run: () => goToTab({ step: 1 }), enabled: () => tabs.tabs.length > 0 },
    'tabs.previous': { run: () => goToTab({ step: -1 }), enabled: () => tabs.tabs.length > 0 },
    ...tabCommands,
    'tabs.selectLast': { run: () => goToTab({ number: 9 }), enabled: () => tabs.tabs.length > 0 },
    'terminal.toggle': { run: toggleTerminal, enabled: () => Boolean(tabs.activeId) },
    'terminal.external': { run: () => tabs.activeId && void run(() => invoke('repo:openTerminal', tabs.activeId!)), enabled: () => Boolean(tabs.activeId) },
    'edit.undo': { run: () => undoRedo(false), enabled: () => canUndo(false) },
    'edit.redo': { run: () => undoRedo(true), enabled: () => canUndo(true) },
    'repo.refresh': { run: () => tabs.activeId && void run(() => invoke('repo:refresh', tabs.activeId!)), enabled: () => Boolean(tabs.activeId) },
    'repo.fetch': { run: () => remoteActions.fetch(), enabled: onRepo },
    'repo.pull': { run: () => remoteActions.pull(), enabled: () => onRepo() && Boolean(repo.data?.branch.head) },
    'repo.pullMerge': { run: () => remoteActions.pull(false), enabled: () => onRepo() && Boolean(repo.data?.branch.head) },
    'repo.pullRebase': { run: () => remoteActions.pull(true), enabled: () => onRepo() && Boolean(repo.data?.branch.head) },
    'repo.push': { run: () => remoteActions.push(), enabled: () => onRepo() && Boolean(repo.data?.branch.head) },
    'repo.stash': {
      run: () => tabs.activeId && void run(() => invoke('stash:push', tabs.activeId!, { message: '', includeUntracked: true, stagedOnly: false })),
      enabled: () => onRepo() && Boolean(repo.data?.changes.length),
    },
    'repo.pop': { run: () => tabs.activeId && repo.data?.stashes[0] && void run(() => invoke('stash:pop', tabs.activeId!, repo.data!.stashes[0]!.sha)), enabled: () => onRepo() && Boolean(repo.data?.stashes.length) },
    ...themeCommands,
  });
  useEffect(() => startShortcuts(), []);
  // The finder hands "> text" over to the command palette.
  useEffect(() => {
    const open = (event: Event) => setPalette((event as CustomEvent<string>).detail);
    window.addEventListener(OPEN_COMMANDS_EVENT, open);
    return () => window.removeEventListener(OPEN_COMMANDS_EVENT, open);
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

  const { open: openMenu, menu } = useContextMenu();
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
        onOpenTerminal={toggleTerminal}
        onPreferences={() => openPreferences()}
        onStash={() => activeId && run(() => invoke('stash:push', activeId, { message: '', includeUntracked: true, stagedOnly: false }))}
        onPop={() => activeId && data?.stashes[0] && run(() => invoke('stash:pop', activeId, data.stashes[0]!.sha))}
        remote={showRepositories ? null : (repo.remote ?? null)}
        onPull={() => remoteActions.pull()}
        onPullMenu={(event) => remoteActions.pullMenu(event, openMenu)}
        onPush={remoteActions.push}
        onCancelRemote={() => activeId && void invoke('remote:cancel', activeId)}
        undo={showRepositories ? null : (repo.undo ?? null)}
        onUndo={() => activeId && run(() => invoke('undo:undo', activeId))}
        onRedo={() => activeId && run(() => invoke('undo:redo', activeId))}
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
      {remoteActions.dialogs}
      {menu}
      {prompts[0] && (
        <PromptDialog key={prompts[0].id} prompt={prompts[0]} repoName={tabs.tabs.find((tab) => tab.id === prompts[0]!.repo)?.name ?? null} />
      )}
      {screen === 'preferences' && <Preferences key={preferencesSection ?? ''} repo={data} section={preferencesSection} onClose={() => setScreen('repo')} />}
      {palette !== null && <CommandPalette query={palette} onQuery={setPalette} onClose={() => setPalette(null)} />}
      {screen !== 'preferences' && showRepositories && (
        <RepositoriesScreen
          run={run}
          onOpened={() => setScreen('repo')}
          onClose={tabs.tabs.length ? () => setScreen('repo') : undefined}
          creating={creating}
          onCreating={setCreating}
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
        {terminalRepos
          .filter((id) => tabs.tabs.some((tab) => tab.id === id))
          .map((id) => {
            const visible = terminalOpen && id === activeId && Boolean(data);
            return (
              <div key={id} className="terminal-dock" hidden={!visible} style={{ height: terminalHeight }}>
                <div className="terminal-splitter" role="separator" aria-orientation="horizontal" aria-label="Resize terminal" onPointerDown={resizeTerminal} />
                <TerminalPanel
                  repo={id}
                  visible={visible}
                  onExternal={() => void run(() => invoke('repo:openTerminal', id))}
                  onHide={() => setTerminalOpen(false)}
                  onEmpty={() => setTerminalRepos((current) => current.filter((r) => r !== id))}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}
