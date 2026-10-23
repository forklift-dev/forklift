import { join } from 'node:path';
import { app, BrowserWindow, session, shell } from 'electron';
import { DiffTools } from './external/diffTools';
import { ExternalTools } from './external/tools';
import { BranchService } from './git/branches';
import { GitCli, isVersionAtLeast, MIN_GIT_VERSION } from './git/cli';
import { RepoQueue } from './git/repoQueue';
import { StashService } from './git/stash';
import { ConflictService } from './git/conflicts';
import { CommitOps } from './git/commitOps';
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
import { RepoScanner } from './repos/scan';
import { RepoSession } from './repos/session';
import { startReplication } from './replication';
import { SettingsFile } from './settings/file';
import { SettingsService } from './settings/service';
import { ToolActions } from './settings/toolActions';
import { createAppStore, gitCliDetected, noticeAdded, promptAdded, promptRemoved } from './store';
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
  const settings = new SettingsService({
    store,
    file: new SettingsFile(join(app.getPath('userData'), 'settings.json')),
    runner,
    isOpenRepo: (root) => Boolean(store.getState().repos.byId[root]),
  });
  // Before the window exists, so its first state snapshot already has the user's settings.
  await settings.load();
  const gitCli = new GitCli(runner, () => settings.values['git.executable'] || 'git');
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
  const toolActions = new ToolActions(gitCli, tools, diffTools, settings);
  const scanner = new RepoScanner();
  const history = new HistoryService();
  registerCommands(createCommandHandlers({ store, git, tools, diffTools, staging, settings, toolActions, scanner, history, branches, stashes, conflicts, commitOps, remotes, answerPrompt }), replication);

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
  if (!app.isPackaged) Object.assign(globalThis, { forkliftDebug: { store, runner, gitCli, tools, diffTools, staging, settings, toolActions, repoSession, history, watch, branches, stashes } });

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
