import { delimiter, sep } from 'node:path';
import type { Env } from '../../shared/process';

// Variables Electron/Node set for themselves; leaking them makes child Electron apps
// (VS Code, other editors) start as plain Node or inherit our debugging flags.
const DROPPED_PREFIXES = ['ELECTRON_', 'CHROME_', 'VSCODE_'];
const DROPPED_KEYS = new Set(['NODE_OPTIONS', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE', 'GOOGLE_API_KEY']);

// The AppImage runtime prepends its mount point to these lists so the bundled app finds its libraries.
const APPIMAGE_KEYS = ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'];
const PATH_LIST_KEYS = ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR', 'PERLLIB', 'PYTHONPATH', 'QT_PLUGIN_PATH'];

/**
 * Environment for programs we start on the user's behalf: theirs, minus what our own runtime
 * (Electron, AppImage packaging) injected.
 */
export function sanitizeEnv(source: NodeJS.ProcessEnv | Env): Env {
  const env: Env = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || DROPPED_KEYS.has(key) || DROPPED_PREFIXES.some((p) => key.startsWith(p))) continue;
    env[key] = value;
  }

  // Electron on Linux overrides XDG_CURRENT_DESKTOP (to make Chromium pick a theme) and keeps the
  // user's value in ORIGINAL_XDG_CURRENT_DESKTOP; terminals and editors need the real one.
  if (env['ORIGINAL_XDG_CURRENT_DESKTOP'] !== undefined) {
    env['XDG_CURRENT_DESKTOP'] = env['ORIGINAL_XDG_CURRENT_DESKTOP'];
    delete env['ORIGINAL_XDG_CURRENT_DESKTOP'];
  }

  const appDir = env['APPIMAGE'] !== undefined ? env['APPDIR'] : undefined;
  if (appDir) {
    const inside = (entry: string) => entry === appDir || entry.startsWith(appDir + sep);
    for (const key of PATH_LIST_KEYS) {
      const value = env[key];
      if (value === undefined) continue;
      const kept = value.split(delimiter).filter((entry) => entry && !inside(entry));
      if (kept.length > 0) env[key] = kept.join(delimiter);
      else delete env[key];
    }
    for (const key of APPIMAGE_KEYS) delete env[key];
  }

  return env;
}
