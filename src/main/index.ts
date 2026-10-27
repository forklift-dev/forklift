import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, net, safeStorage, session, shell } from 'electron';
import { DiffTools } from './external/diffTools';
import { GitToolSetup, type GitToolScope } from './external/gitToolSetup';
import { ExternalTools } from './external/tools';
import { BranchService } from './git/branches';
import { GitCli, isVersionAtLeast, MIN_GIT_VERSION } from './git/cli';
import { RepoQueue } from './git/repoQueue';
import { StashService } from './git/stash';
import { ConflictService } from './git/conflicts';
import { CommitOps } from './git/commitOps';
import { BisectService } from './git/bisect';
import { InteractiveRebase } from './git/interactiveRebase';
import { UndoService } from './git/undo';
import { FileHistory } from './git/fileHistory';
import { TerminalService } from './terminal/service';
import { TERMINAL_INPUT_CHANNEL } from '../shared/terminal';
import { isTrustedSender } from './origin';
import { RemoteService } from './git/remote';
import { runAskpassClient, runCredentialClient } from './askpass/client';
import { CredentialStore, type SecretBox } from './askpass/credentials';
import { HostingService } from './hosting/service';
import { TokenStore } from './hosting/tokens';
import { ASKPASS_FLAG, CREDENTIAL_ARG } from './askpass/protocol';
import { AskpassServer, type PromptAnswer } from './askpass/server';
import { createGitService } from './git/service';
import { HistoryService } from './history/service';
import { HistoryStore } from './history/store';
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
import { createAppStore, gitCliDetected, logChanged, noticeAdded, secretStorageChecked, promptAdded, promptRemoved, userThemesRead } from './store';
import { ThemeLibrary } from './themes';
import { OperationLog } from './log/operationLog';
import { AvatarService } from './avatars/service';
import { SubmoduleService } from './git/submodules';
import { WorktreeService } from './git/worktrees';
import { LfsService } from './git/lfs';
import { GitflowService } from './git/gitflow';
import { undoChanged } from './store/reposSlice';
import { WatchManager } from './watch/manager';
import { createMainWindow } from './window';
import { resolveLanguage, setLanguage } from '../shared/i18n';

// Started by git or ssh to ask for credentials (see AskpassServer): no window, no single-instance lock.
const askpassMode = process.argv.includes(ASKPASS_FLAG);
const commandArgs = process.argv.slice(app.isPackaged ? 1 : 2);
const configCommand = commandArgs[0] === 'setup' || commandArgs[0] === 'uninstall' ? commandArgs[0] : null;
if (!askpassMode && !configCommand) registerAppScheme();

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
  const store = createAppStore({ version: app.getVersion(), platform: process.platform }, { git }, { checks: !app.isPackaged });
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
  // Messages made here (errors, dialogs) in the window's language; the window follows the same setting.
  const applyLanguage = () => setLanguage(resolveLanguage(settings.values['ui.language'], [app.getLocale()]));
  applyLanguage();
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
  const bisect = new BisectService(gitCli, repoQueue);
  // Credential prompts: shown in the window; answers go straight to the waiting git process. Passwords the
  // user asks to remember are kept by the app's credential helper, encrypted with the system keychain.
  const waiting = new Map<number, (answer: PromptAnswer | null) => void>();
  const secretBox: SecretBox = {
    // Linux without a keyring falls back to "basic_text" (no real protection): then nothing is stored.
    available: async () =>
      (await safeStorage.isAsyncEncryptionAvailable()) &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text' || (!app.isPackaged && process.env['FORKLIFT_TEST_BASIC_SECRETS'] === '1')),
    encrypt: (text) => safeStorage.encryptStringAsync(text),
    decrypt: async (data) => {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(data);
      return { text: result, reencrypt: shouldReEncrypt };
    },
  };
  const credentials = new CredentialStore(join(app.getPath('userData'), 'credentials.json'), secretBox);
  // Hosting accounts (Preferences → Integrations): their tokens are encrypted like the passwords.
  const hosting = new HostingService({
    accounts: () => settings.values['integrations.accounts'],
    saveAccounts: (accounts) => settings.update({ values: { 'integrations.accounts': accounts } }),
    tokens: new TokenStore(join(app.getPath('userData'), 'hosting-tokens.json'), secretBox),
    // Chromium's network stack (system proxy and certificates). Only the token-less probe of where a redirect
    // leads uses Node's fetch: Electron's cannot report a redirect's Location.
    // An API client's own User-Agent: with Chromium's, servers behind bot protection (Anubis on
    // next.forgejo.org) answer with a challenge page instead of JSON.
    fetch: (url, init) => {
      const request = { ...init, headers: { 'User-Agent': `Forklift/${app.getVersion()}`, ...init.headers } };
      return init.redirect === 'manual' ? globalThis.fetch(url, request) : net.fetch(url, request);
    },
  });
  // git asks the saved passwords first, then an account's token for its server (never kept twice).
  const gitCredentials = {
    get: async (fields: Record<string, string>) => (await credentials.get(fields)) ?? (await hosting.credential(fields)),
    store: async (fields: Record<string, string>) => {
      if ((await hosting.credential(fields))?.password === fields['password']) return;
      await credentials.store(fields);
    },
    erase: (fields: Record<string, string>) => credentials.erase(fields),
  };
  // Asks the keychain once (KDE Wallet or GNOME Keyring may show their unlock dialog then).
  void credentials.available().then(
    (available) => store.dispatch(secretStorageChecked(available)),
    () => store.dispatch(secretStorageChecked(false)),
  );
  const askpass = new AskpassServer({
    credentials: gitCredentials,
    scriptDir: join(app.getPath('userData'), 'askpass'),
    command: { executable: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] },
    ask: (prompt) =>
      new Promise((resolve) => {
        waiting.set(prompt.id, resolve);
        store.dispatch(promptAdded(prompt));
      }).finally(() => {
        waiting.delete(prompt.id);
        store.dispatch(promptRemoved(prompt.id));
      }) as Promise<PromptAnswer | null>,
    onCancel: (id) => waiting.get(id)?.(null),
  });
  await askpass.start();
  app.on('will-quit', () => void askpass.stop());
  const remotes = new RemoteService(gitCli, askpass, repoQueue);
  const answerPrompt = (id: number, answer: string | null, remember: boolean) => waiting.get(id)?.(answer === null ? null : { answer, remember });
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
  const history = new HistoryService(gitCli, new HistoryStore(join(app.getPath('userData'), 'history')));
  registerCommands(createCommandHandlers({ store, git, tools, diffTools, staging, settings, toolActions, scanner, history, branches, stashes, conflicts, commitOps, bisect, remotes, networkOps, interactiveRebase: new InteractiveRebase(gitCli, repoQueue), undo, fileHistory: new FileHistory(gitCli), terminals, creator: new RepoCreator(gitCli, remotes, () => settings.values['general.repositoriesFolder']), profiles, log, avatars: new AvatarService({ cacheDir: join(app.getPath('userData'), 'avatars'), enabled: () => settings.values['ui.gravatar'], fetch: (url, init) => net.fetch(url, init) }), submodules: new SubmoduleService(gitCli, remotes, repoQueue), worktrees: new WorktreeService(gitCli, repoQueue), lfs: new LfsService(gitCli, remotes, repoQueue), gitflow: new GitflowService(gitCli, repoQueue), gitCli, credentials, hosting, processes: runner, listFiles: (root) => listFiles(gitCli, root), shellEnv: () => runner.environment(), onFetched: (root) => autoFetch.fetched(root), answerPrompt }), { waitForAck: (id) => replication.waitForAck(id), log });

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
  store.subscribe(applyLanguage);
  let gitExecutable = settings.values['git.executable'];
  store.subscribe(() => {
    if (settings.values['git.executable'] === gitExecutable) return;
    gitExecutable = settings.values['git.executable'];
    void detectGit();
  });

  // Handle for poking services from the main-process inspector (`--inspect`) in dev builds.
  if (!app.isPackaged) Object.assign(globalThis, { forkliftDebug: { store, runner, gitCli, tools, diffTools, staging, settings, toolActions, repoSession, history, watch, branches, stashes, autoFetch, undo, terminals } });

  // The interface scale: for the window as it loads, and again whenever the setting changes.
  const zoomFactor = () => settings.values['ui.zoom'] / 100;
  app.on('browser-window-created', (_event, window) => window.webContents.on('did-finish-load', () => window.webContents.setZoomFactor(zoomFactor())));
  let zoom = settings.values['ui.zoom'];
  store.subscribe(() => {
    if (settings.values['ui.zoom'] === zoom) return;
    zoom = settings.values['ui.zoom'];
    for (const window of BrowserWindow.getAllWindows()) window.webContents.setZoomFactor(zoomFactor());
  });

  showMainWindow();
  app.on('activate', showMainWindow);
}

async function runGitToolConfigCommand(command: 'setup' | 'uninstall', args: string[]): Promise<void> {
  let scope: GitToolScope = 'global';
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--local') scope = 'local';
    else if (arg === '--dry-run') dryRun = true;
    else throw new TypeError(`unknown ${command} option: ${arg}`);
  }

  await app.whenReady();
  const runner = new ProcessRunner();
  try {
    const setup = new GitToolSetup(new GitCli(runner));
    const executable = app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
    const changes = command === 'setup'
      ? await setup.setup(process.cwd(), scope, executable, dryRun)
      : await setup.uninstall(process.cwd(), scope, dryRun);
    const verb = command === 'setup' ? 'Set' : 'Restore';
    const lines = changes.map(({ key, values }) => values.length ? `${verb} ${key} = ${values.join(', ')}` : `Remove ${key}`);
    process.stdout.write(`${dryRun ? 'Dry run — no changes written.\n' : ''}${lines.join('\n')}\n`, () => app.exit(0));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => app.exit(1));
  } finally {
    runner.dispose();
  }
}

if (askpassMode) {
  const extra = process.argv.slice(process.argv.indexOf(ASKPASS_FLAG) + 1);
  const finish = (code: number) => process.stdout.write('', () => process.exit(code)); // let stdout drain
  if (extra[0] === CREDENTIAL_ARG && extra.length === 2) {
    // git's credential helper protocol: fields on stdin, the action as the argument.
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => (input += chunk));
    process.stdin.on('end', () => void runCredentialClient(extra[1]!, input, process.env, (text) => process.stdout.write(text)).then(finish));
  } else {
    const prompt = process.argv[process.argv.length - 1] ?? '';
    void runAskpassClient(prompt === ASKPASS_FLAG ? '' : prompt, process.env, (text) => process.stdout.write(text)).then(finish);
  }
} else if (configCommand) {
  void runGitToolConfigCommand(configCommand, commandArgs.slice(1));
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
