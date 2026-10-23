import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { enableDevToolsShortcut } from './menu';
import { APP_ENTRY_URL, devServerUrl, isAppUrl } from './origin';

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Forklift',
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Linux shows this in the taskbar and window switcher (macOS and Windows take the packaged app's icon).
    ...(process.platform === 'linux' && { icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icons', '512x512.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.once('ready-to-show', () => window.show());
  enableDevToolsShortcut(window);

  // External links open in the user's browser; the app never spawns extra windows.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  void window.loadURL(devServerUrl ?? APP_ENTRY_URL);
  return window;
}
