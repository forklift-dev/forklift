import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import type { Env } from '../../shared/process';

/**
 * Finds `name` the way the OS would when spawning it: absolute paths as given, otherwise the
 * first executable match in PATH (on Windows also trying each PATHEXT extension).
 */
export async function findExecutable(name: string, env: Env, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  const windows = platform === 'win32';
  const extensions = windows && !extname(name) ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const candidates = isAbsolute(name)
    ? extensions.map((ext) => name + ext)
    : (env['PATH'] ?? env['Path'] ?? '')
        .split(windows ? ';' : delimiter)
        .filter(Boolean)
        .flatMap((dir) => extensions.map((ext) => join(dir, name + ext)));

  for (const candidate of candidates) {
    try {
      // Windows has no executable bit; existence is what the loader checks.
      await access(candidate, windows ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}
