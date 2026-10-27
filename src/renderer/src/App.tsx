import { useEffect, useState, useTransition, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { SettingsSection } from '../../shared/settings';
import type { TabsState } from '../../shared/state';
import { BUILTIN_THEMES } from '../../shared/themes';
import { invoke, logIdOf } from './api';
import { LogView } from './components/LogView';
import { Toasts } from './components/Toasts';
import { OPEN_COMMANDS_EVENT, runCommand, startShortcuts, useCommandHandlers } from './commands';
import { CommandPalette } from './components/CommandPalette';
import { ProfileSwitcher } from './components/ProfileSwitcher';
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
import { StatusBar } from './components/StatusBar';
import { getState, useAppState } from './state';
import { useLanguage } from './i18n';
import { t, translate } from '../../shared/i18n';

/** Runs a command and reports failures in the banner; resolves to whether it succeeded. */
export type RunAction = (action: () => Promise<unknown>) => Promise<boolean>;

type Screen = 'repo' | 'repositories' | 'preferences' | 'log';

/** Percent per Zoom in / Zoom out. */
const ZOOM_STEP = 10;
/** The scale last asked for while main is still saving it. */
let pendingZoom: number | null = null;

/** Tab to switch to for Ctrl+Tab (+1), Ctrl+Shift+Tab (-1) or Ctrl+N (index N-1; Ctrl+9 is the last tab). */
function tabFor(tabs: TabsState, key: { step?: number; number?: number }): string | null {
  const list = tabs.tabs;
  if (list.length === 0) return null;
  if (key.number !== undefined) return (key.number === 9 ? list.at(-1) : list[key.number - 1])?.id ?? null;
  const current = list.findIndex((tab) => tab.id === tabs.activeId);
  return list[(current + key.step! + list.length) % list.length]!.id;
}

export function App() {
  // The whole app renders again in a new language (nothing below is memoized).
  useLanguage();
  const tabs = useAppState((s) => s.tabs);
  const repo = useAppState((s) => s.repo);
  const notices = useAppState((s) => s.app.notices);
  const prompts = useAppState((s) => s.app.prompts);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<{ message: string; logId: number | null } | null>(null);
  const [logFocus, setLogFocus] = useState<number | null>(null);
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
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const [preferencesSection, setPreferencesSection] = useState<SettingsSection | undefined>(undefined);
  const [creating, setCreating] = useState<NewRepoKind | null>(null);
  const userThemes = useAppState((s) => s.app.userThemes.themes);
  const library = useAppState((s) => s.library);
  const statusBarVisible = useAppState((s) => s.settings.values['ui.statusBar']);

  const reportError = (error: unknown) => setActionError({ message: error instanceof Error ? error.message : String(error), logId: logIdOf(error) });
  const showLog = (id: number | null) => {
    setLogFocus(id);
    setScreen('log');
  };

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
      { title: t('Use the {theme} theme', { theme: translate(theme.name) }), category: 'View', run: () => void run(() => invoke('settings:update', { values: { 'ui.theme': theme.id } })) },
    ]),
  );
  // From the value asked for last (the replica catches up only after main saved it): quick presses each take a step.
  const zoomBy = (step: number | null) => {
    const current = pendingZoom ?? getState().settings.values['ui.zoom'];
    const value = step === null ? 100 : Math.min(200, Math.max(50, current + step));
    if (value === current) return;
    pendingZoom = value;
    void run(() => invoke('settings:update', { values: { 'ui.zoom': value } })).finally(() => {
      if (pendingZoom === value) pendingZoom = null;
    });
  };
  useCommandHandlers({
    'palette.commands': { run: () => setPalette('') },
    'app.preferences': { run: () => openPreferences() },
    'app.keybindings': { run: () => openPreferences('keys') },
    'view.zoomIn': { run: () => zoomBy(ZOOM_STEP) },
    'view.zoomOut': { run: () => zoomBy(-ZOOM_STEP) },
    'view.zoomReset': { run: () => zoomBy(null) },
    'view.toggleStatusBar': { run: () => void run(() => invoke('settings:update', { values: { 'ui.statusBar': !getState().settings.values['ui.statusBar'] } })) },
    'theme.choose': { run: () => openPreferences('ui') },
    'profile.switch': { run: () => setSwitchingProfile(true) },
    'app.log': { run: () => showLog(null) },
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
  const showRepositories = screen === 'repositories' || (tabs.tabs.length === 0 && screen !== 'log');

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
        onShowLog={() => showLog(null)}
        onPreferences={() => openPreferences()}
        onProfiles={() => setSwitchingProfile(true)}
        managerOpen={showRepositories && screen !== 'preferences'}
        onActivate={activate}
        onClose={closeTab}
        onMove={(id, index) => void run(() => invoke('repo:move', id, index))}
        onNewTab={() => setScreen('repositories')}
      />
      <Toolbar
        repo={showRepositories ? null : data}
        busy={busy}
        onOpenTerminal={toggleTerminal}
        onCreateBranch={() => runCommand('repo.createBranch')}
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
        onRepoMenu={(event) =>
          openMenu(event, [
            ...library.recent
              .filter((entry) => entry.path !== activeId)
              .slice(0, 8)
              .map((entry) => ({ label: entry.name, onSelect: () => void run(() => invoke('repo:open', entry.path)).then((ok) => ok && setScreen('repo')) })),
            ...(library.recent.some((entry) => entry.path !== activeId) ? (['separator'] as const) : []),
            { label: t('Open a repository…'), onSelect: () => setScreen('repositories') },
            { label: t('Clone a repository…'), onSelect: () => openCreate('clone') },
            { label: t('Create a repository…'), onSelect: () => openCreate('init') },
            'separator',
            { label: t('Refresh'), disabled: !activeId, onSelect: () => activeId && void run(() => invoke('repo:refresh', activeId)) },
            { label: t('Close tab'), disabled: !activeId, onSelect: () => activeId && closeTab(activeId) },
          ])
        }
        onSwitchBranch={() => runCommand('branch.switch')}
        onSetUpstream={() => runCommand('branch.setUpstream')}
        onActions={() => setPalette('')}
        onSearch={() => runCommand('palette.find')}
      />
      {notices.length > 0 && (
        <div className="error-banner notices" role="alert">
          {notices.join('\n')}
          <button type="button" onClick={() => void invoke('app:dismissNotices')}>
            {t('Dismiss')}
          </button>
        </div>
      )}
      {error && (
        <div className="error-banner">
          {error.message}
          {error.logId !== null && (
            <button type="button" className="error-details" onClick={() => showLog(error.logId)}>
              {t('Details')}
            </button>
          )}
        </div>
      )}
      <Toasts onShowLog={showLog} />
      {remoteActions.dialogs}
      {menu}
      {prompts[0] && (
        <PromptDialog key={prompts[0].id} prompt={prompts[0]} repoName={tabs.tabs.find((tab) => tab.id === prompts[0]!.repo)?.name ?? null} />
      )}
      {screen === 'log' && <LogView key={logFocus ?? 0} focus={logFocus} onClose={() => setScreen('repo')} />}
      {screen === 'preferences' && <Preferences key={preferencesSection ?? ''} repo={data} section={preferencesSection} onClose={() => setScreen('repo')} />}
      {palette !== null && <CommandPalette query={palette} onQuery={setPalette} onClose={() => setPalette(null)} />}
      {switchingProfile && <ProfileSwitcher repo={screen === 'repo' ? tabs.activeId : null} run={run} onClose={() => setSwitchingProfile(false)} onEdit={() => openPreferences('profiles')} />}
      {screen !== 'preferences' && screen !== 'log' && showRepositories && (
        <RepositoriesScreen
          run={run}
          onOpened={() => setScreen('repo')}
          onClose={tabs.tabs.length ? () => setScreen('repo') : undefined}
          creating={creating}
          onCreating={setCreating}
        />
      )}
      {/* Kept mounted under the other screens, so the selection and an open diff survive a visit there. */}
      <div className="app-main" hidden={screen === 'preferences' || screen === 'log' || showRepositories}>
        {data ? (
          // Keyed by repository: selection and open diff belong to the repository they were made in.
          <RepoWorkspace key={data.root} data={data} run={run} runInBackground={runInBackground} />
        ) : repo.loading ? (
          <main className="empty">
            <p>{t('Loading {name}…', { name: tabs.tabs.find((tab) => tab.id === activeId)?.name ?? '' })}</p>
          </main>
        ) : (
          activeId &&
          repo.error && (
            <main className="empty repo-unavailable">
              <p>{repo.error}</p>
              <div className="empty-actions">
                <button type="button" onClick={() => void run(() => invoke('repo:refresh', activeId))}>
                  {t('Try again')}
                </button>
                <button type="button" onClick={() => closeTab(activeId)}>
                  {t('Remove tab')}
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
                <div className="terminal-splitter" role="separator" aria-orientation="horizontal" aria-label={t('Resize terminal')} onPointerDown={resizeTerminal} />
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
      {statusBarVisible && (
        <StatusBar
          repo={data}
          remote={repo.remote ?? null}
          onBranch={() => {
            setScreen('repo');
            requestAnimationFrame(() => runCommand('branch.switch'));
          }}
          onChanges={() => {
            setScreen('repo');
            requestAnimationFrame(() => runCommand('repo.focusCommit'));
          }}
          onFetch={() => remoteActions.fetch()}
          onLog={() => showLog(null)}
          onPreferences={openPreferences}
          onGraphStyle={(style) => void run(() => invoke('settings:update', { values: { 'ui.graphStyle': style } }))}
          onWriteCommitGraph={() => activeId && void run(() => invoke('repo:writeCommitGraph', activeId))}
        />
      )}
    </div>
  );
}
