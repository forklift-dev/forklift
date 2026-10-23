import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, net, session, shell } from 'electron';
import { DiffTools } from './external/diffTools';
import { ExternalTools } from './external/tools';
import { BranchService } from './git/branches';
import { GitCli, isVersionAtLeast, MIN_GIT_VERSION } from './git/cli';
import { RepoQueue } from './git/repoQueue';
import { StashService } from './git/stash';
import { ConflictService } from './git/conflicts';
import { CommitOps } from './git/commitOps';
import { InteractiveRebase } from './git/interactiveRebase';
import { UndoService } from './git/undo';
import { FileHistory } from './git/fileHistory';
import { TerminalService } from './terminal/service';
import { TERMINAL_INPUT_CHANNEL } from '../shared/terminal';
import { isTrustedSender } from './origin';
import { RemoteService } from './git/remote';
import { runAskpassClient } from './askpass/client';
import { ASKPASS_FLAG } from './askpass/protocol';
import { AskpassServer } from './askpass/server';
import { createGitService } from './git/service';
import { HistoryService } from './history/service';
import { StagingService } from './git/staging';
import { createCommandHandlers } from './ipc/handlers';
import { registerCommands } from './ipc/registry';
import { sanitizeEnv } from './process/env';
import { ProcessRunner } from './process/runner';
import { resolveShellEnv, shouldResolveShellEnv } from './process/shellEnv';
import { installAppMenu } from './menu';
import { handleAppProtocol, registerAppScheme } from './protocol';
import { pathFromArgv } from './repos/argv';
import { LibraryFile } from './repos/libraryFile';
import { RepoCreator } from './repos/create';
import { ProfileService } from './profiles/service';
import { listFiles } from './git/files';
import { RepoScanner } from './repos/scan';
import { AutoFetch } from './repos/autoFetch';
import { NetworkOps } from './repos/network';
import { RepoSession } from './repos/session';
import { startReplication } from './replication';
import { SettingsFile } from './settings/file';
import { SettingsService } from './settings/service';
import { ToolActions } from './settings/toolActions';
import { createAppStore, gitCliDetected, logChanged, noticeAdded, promptAdded, promptRemoved, userThemesRead } from './store';
import { ThemeLibrary } from './themes';
import { OperationLog } from './log/operationLog';
import { AvatarService } from './avatars/service';
import { SubmoduleService } from './git/submodules';
import { undoChanged } from './store/reposSlice';
import { WatchManager } from './watch/manager';
import { createMainWindow } from './window';

// Started by git or ssh to ask for credentials (see AskpassServer): no window, no single-instance lock.
const askpassMode = process.argv.includes(ASKPASS_FLAG);
if (!askpassMode) registerAppScheme();

let mainWindow: BrowserWindow | null = null;
/** Opens a folder named by a later launch (`forklift <path>` while running); set once the app is ready. */
let openFromSecondInstance: ((argv: string[], cwd: string) => void) | null = null;

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

async function start() {
  await app.whenReady();
  installAppMenu();

  handleAppProtocol(join(__dirname, '../renderer'));
  // The UI needs no camera, notifications, geolocation, etc.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const git = createGitService();
  const store = createAppStore({ version: app.getVersion(), platform: process.platform }, { git });
  const replication = startReplication(store);
  const runner = new ProcessRunner();
  const themes = new ThemeLibrary(join(app.getPath('userData'), 'themes'), (state) => store.dispatch(userThemesRead(state)));
  const settings = new SettingsService({
    store,
    file: new SettingsFile(join(app.getPath('userData'), 'settings.json')),
    runner,
    isOpenRepo: (root) => Boolean(store.getState().repos.byId[root]),
    themeExists: (id) => themes.exists(id),
  });
  // Before the window exists, so its first state snapshot already has the user's settings and themes.
  await Promise.all([settings.load(), themes.start().catch((error: unknown) => console.error('[themes] could not read user themes:', error))]);
  app.on('will-quit', () => themes.stop());
  // Every git run, and every window command that changes something, for Help → Operation log.
  let logTimer: NodeJS.Timeout | null = null;
  const log = new OperationLog(() => {
    logTimer ??= setTimeout(() => {
      logTimer = null;
      store.dispatch(logChanged());
    }, 250);
  });
  const gitCli = new GitCli(runner, () => settings.values['git.executable'] || 'git', (run) => log.git(run));
  const tools = new ExternalTools({ runner, openPath: (path) => shell.openPath(path) });
  const diffTools = new DiffTools(gitCli, runner);
  // Index, HEAD and working tree are written one operation at a time per repository.
  const repoQueue = new RepoQueue();
  const staging = new StagingService(gitCli, git, repoQueue);
  const stashes = new StashService(gitCli, repoQueue);
  const branches = new BranchService(gitCli, repoQueue, stashes);
  const conflicts = new ConflictService(gitCli, repoQueue);
  const commitOps = new CommitOps(gitCli, repoQueue);
  // Credential prompts: shown in the window; answers go straight to the waiting git process.
  const waiting = new Map<number, (answer: string | null) => void>();
  const askpass = new AskpassServer({
    scriptDir: join(app.getPath('userData'), 'askpass'),
    command: { executable: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] },
    ask: (prompt) =>
      new Promise((resolve) => {
        waiting.set(prompt.id, resolve);
        store.dispatch(promptAdded(prompt));
      }).finally(() => {
        waiting.delete(prompt.id);
        store.dispatch(promptRemoved(prompt.id));
      }) as Promise<string | null>,
    onCancel: (id) => waiting.get(id)?.(null),
  });
  await askpass.start();
  app.on('will-quit', () => void askpass.stop());
  const remotes = new RemoteService(gitCli, askpass, repoQueue);
  const answerPrompt = (id: number, answer: string | null) => waiting.get(id)?.(answer);
  const networkOps = new NetworkOps(store);
  const terminals = new TerminalService();
  app.on('will-quit', () => terminals.dispose());
  // Keystrokes: frequent and fire-and-forget, so a plain channel; only the app's own page may type.
  ipcMain.on(TERMINAL_INPUT_CHANNEL, (event, id: unknown, data: unknown) => {
    if (!isTrustedSender(event.senderFrame) || !Number.isInteger(id) || typeof data !== 'string' || data.length > 1_000_000) return;
    terminals.write(event.sender, id as number, data);
  });
  const undo = new UndoService({
    git: gitCli,
    branches,
    staging,
    stashes,
    queue: repoQueue,
    saveDir: join(app.getPath('temp'), `forklift-undo-${process.pid}`),
    changed: (root, labels) => store.dispatch(undoChanged({ id: root, ...labels })),
  });
  const autoFetch = new AutoFetch({ store, settings, networkOps, remotes, log, isFocused: () => BrowserWindow.getFocusedWindow() !== null });
  autoFetch.start();
  app.on('will-quit', () => autoFetch.stop());
  const toolActions = new ToolActions(gitCli, tools, diffTools, settings);
  const profiles = new ProfileService({ git: gitCli, runner, askpass, allowedSignersFile: join(app.getPath('userData'), 'allowed_signers') });
  // SSH signatures made with a profile's key verify without extra setup.
  let signers = settings.values['profiles.list'];
  const writeSigners = () => void profiles.writeAllowedSigners(signers).catch((error: unknown) => console.error('[profiles] could not write allowed signers:', error));
  writeSigners();
  store.subscribe(() => {
    if (settings.values['profiles.list'] === signers) return;
    signers = settings.values['profiles.list'];
    writeSigners();
  });
  const scanner = new RepoScanner();
  const history = new HistoryService(gitCli);
  registerCommands(createCommandHandlers({ store, git, tools, diffTools, staging, settings, toolActions, scanner, history, branches, stashes, conflicts, commitOps, remotes, networkOps, interactiveRebase: new InteractiveRebase(gitCli, repoQueue), undo, fileHistory: new FileHistory(gitCli), terminals, creator: new RepoCreator(gitCli, remotes, () => settings.values['general.repositoriesFolder']), profiles, log, avatars: new AvatarService({ cacheDir: join(app.getPath('userData'), 'avatars'), enabled: () => settings.values['ui.gravatar'], fetch: (url, init) => net.fetch(url, init) }), submodules: new SubmoduleService(gitCli, remotes, repoQueue), listFiles: (root) => listFiles(gitCli, root), shellEnv: () => runner.environment(), onFetched: (root) => autoFetch.fetched(root), answerPrompt }), { waitForAck: (id) => replication.waitForAck(id), log });

  // Remembered tabs first, then a folder named on the command line (opened as the active tab).
  const repoSession = new RepoSession(store, new LibraryFile(join(app.getPath('userData'), 'repositories.json')));
  await repoSession.load(settings.values['general.restoreTabs']);
  const report = (message: string) => store.dispatch(noticeAdded(message));
  const cliPath = pathFromArgv(process.argv, app.isPackaged, process.cwd());
  if (cliPath) void repoSession.open(git, cliPath, report);
  // Changes made outside the app (editors, git in a terminal) show up by themselves.
  const watch = new WatchManager(store, undefined, (root) => repoQueue.idle(root));
  watch.start();
  app.on('browser-window-focus', () => watch.refreshActive());
  app.on('will-quit', () => void watch.stop());
  openFromSecondInstance = (argv, cwd) => {
    const path = pathFromArgv(argv, app.isPackaged, cwd);
    if (path) void repoSession.open(git, path, report);
  };

  app.on('will-quit', () => runner.dispose());
  if (shouldResolveShellEnv(process.env, process.platform, Boolean(process.stdout.isTTY))) {
    // Commands issued meanwhile wait for this, so they already see the user's PATH.
    const shellEnv = resolveShellEnv((command, args, options) => runner.run(command, args, { ...options, replaceEnv: true }), {
      env: sanitizeEnv(process.env),
      log: (message) => console.log(`[process] ${message}`),
    });
    runner.setBaseEnv(shellEnv.then((env) => env ?? process.env));
  }
  const detectGit = () =>
    gitCli.version().then((version) =>
      store.dispatch(
        gitCliDetected({
          version,
          minimumVersion: MIN_GIT_VERSION,
          meetsMinimum: version !== null && isVersionAtLeast(version, MIN_GIT_VERSION),
        }),
      ),
    );
  void detectGit();
  let gitExecutable = settings.values['git.executable'];
  store.subscribe(() => {
    if (settings.values['git.executable'] === gitExecutable) return;
    gitExecutable = settings.values['git.executable'];
    void detectGit();
  });

  // Handle for poking services from the main-process inspector (`--inspect`) in dev builds.
  if (!app.isPackaged) Object.assign(globalThis, { forkliftDebug: { store, runner, gitCli, tools, diffTools, staging, settings, toolActions, repoSession, history, watch, branches, stashes, autoFetch, undo, terminals } });

  showMainWindow();
  app.on('activate', showMainWindow);
}

if (askpassMode) {
  const prompt = process.argv[process.argv.length - 1] ?? '';
  void runAskpassClient(prompt === ASKPASS_FLAG ? '' : prompt, process.env, (text) => process.stdout.write(text)).then((code) => {
    // Let stdout drain before leaving.
    process.stdout.write('', () => process.exit(code));
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, cwd) => {
    showMainWindow();
    openFromSecondInstance?.(argv, cwd);
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  start().catch((error) => {
    console.error('Failed to start', error);
    app.exit(1);
  });
}
