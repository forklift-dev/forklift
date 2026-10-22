import { app, type WebFrameMain } from 'electron';

// Production renderer is served from app://forklift/ instead of file://, so the
// GrantFileProtocolExtraPrivileges fuse can stay off.
export const APP_SCHEME = 'app';
export const APP_HOST = 'forklift';
export const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/** Vite dev server URL injected by electron-vite; never trusted in packaged builds. */
export const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];

export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (devServerUrl) return parsed.origin === new URL(devServerUrl).origin;
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
  } catch {
    return false;
  }
}

/** Only our own top-level page may talk to the main process. */
export function isTrustedSender(frame: WebFrameMain | null | undefined): boolean {
  return !!frame && frame.parent === null && isAppUrl(frame.url);
}
