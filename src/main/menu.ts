import { app, Menu, type BrowserWindow } from 'electron';

/**
 * The window has its own toolbar and shortcuts (Ctrl+W closes a tab, Ctrl+Tab switches tabs), so
 * Windows and Linux get no menu bar and none of Electron's default accelerators (Ctrl+W closing the
 * window, Ctrl+R reloading it). macOS needs a menu for the app name, Quit and the Edit shortcuts.
 */
export function installAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'Edit',
        submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
      },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    ]),
  );
}

/** Development builds keep a way to the DevTools without the default menu. */
export function enableDevToolsShortcut(window: BrowserWindow): void {
  if (app.isPackaged) return;
  window.webContents.on('before-input-event', (event, input) => {
    const toggle = input.type === 'keyDown' && (input.key === 'F12' || (input.key.toLowerCase() === 'i' && input.shift && (input.control || input.meta)));
    if (!toggle) return;
    event.preventDefault();
    window.webContents.toggleDevTools();
  });
}
