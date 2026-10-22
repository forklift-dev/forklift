import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { detectGitVersion } from './git/cliVersion';
import { createGitService } from './git/service';
import { createCommandHandlers } from './ipc/handlers';
import { registerCommands } from './ipc/registry';
import { ProcessRunner } from './process/runner';
import { handleAppProtocol, registerAppScheme } from './protocol';
import { startReplication } from './replication';
import { createAppStore, gitVersionDetected } from './store';
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

  const store = createAppStore(
    { version: app.getVersion(), platform: process.platform },
    { git: createGitService() },
  );
  const replication = startReplication(store);
  registerCommands(createCommandHandlers(store), replication);

  const runner = new ProcessRunner();
  app.on('will-quit', () => runner.dispose());
  void detectGitVersion(runner).then((version) => store.dispatch(gitVersionDetected(version)));

  // Handle for poking services from the main-process inspector (`--inspect`) in dev builds.
  if (!app.isPackaged) Object.assign(globalThis, { forkliftDebug: { store, runner } });

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
