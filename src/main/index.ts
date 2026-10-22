import { join } from 'node:path';
import { app, BrowserWindow, session, shell } from 'electron';
import { DiffTools } from './external/diffTools';
import { ExternalTools } from './external/tools';
import { GitCli, isVersionAtLeast, MIN_GIT_VERSION } from './git/cli';
import { createGitService } from './git/service';
import { createCommandHandlers } from './ipc/handlers';
import { registerCommands } from './ipc/registry';
import { sanitizeEnv } from './process/env';
import { ProcessRunner } from './process/runner';
import { resolveShellEnv, shouldResolveShellEnv } from './process/shellEnv';
import { handleAppProtocol, registerAppScheme } from './protocol';
import { startReplication } from './replication';
import { createAppStore, gitCliDetected } from './store';
import { createMainWindow } from './window';

registerAppScheme();

let mainWindow: BrowserWindow | null = null;

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

  handleAppProtocol(join(__dirname, '../renderer'));
  // The UI needs no camera, notifications, geolocation, etc.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const git = createGitService();
  const store = createAppStore({ version: app.getVersion(), platform: process.platform }, { git });
  const replication = startReplication(store);
  const runner = new ProcessRunner();
  const gitCli = new GitCli(runner);
  const tools = new ExternalTools({ runner, openPath: (path) => shell.openPath(path) });
  const diffTools = new DiffTools(gitCli, runner);
  registerCommands(createCommandHandlers({ store, git, tools, diffTools }), replication);

  app.on('will-quit', () => runner.dispose());
  if (shouldResolveShellEnv(process.env, process.platform, Boolean(process.stdout.isTTY))) {
    // Commands issued meanwhile wait for this, so they already see the user's PATH.
    const shellEnv = resolveShellEnv((command, args, options) => runner.run(command, args, { ...options, replaceEnv: true }), {
      env: sanitizeEnv(process.env),
      log: (message) => console.log(`[process] ${message}`),
    });
    runner.setBaseEnv(shellEnv.then((env) => env ?? process.env));
  }
  void gitCli.version().then((version) =>
    store.dispatch(
      gitCliDetected({
        version,
        minimumVersion: MIN_GIT_VERSION,
        meetsMinimum: version !== null && isVersionAtLeast(version, MIN_GIT_VERSION),
      }),
    ),
  );

  // Handle for poking services from the main-process inspector (`--inspect`) in dev builds.
  if (!app.isPackaged) Object.assign(globalThis, { forkliftDebug: { store, runner, gitCli, tools, diffTools } });

  showMainWindow();
  app.on('activate', showMainWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  start().catch((error) => {
    console.error('Failed to start', error);
    app.exit(1);
  });
}
