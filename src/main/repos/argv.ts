import { isAbsolute, resolve } from 'node:path';

/**
 * The folder named on the command line (`forklift ~/src/project`), resolved against the caller's
 * working directory. Switches (`--inspect`, Chromium flags) are skipped wherever they are: Chromium
 * moves them in front of the other arguments for a second instance. In development the first
 * positional argument is the app path (`electron . <folder>`).
 */
export function pathFromArgv(argv: readonly string[], packaged: boolean, cwd: string): string | null {
  const positional = argv.slice(1).filter((arg) => arg.length > 0 && !arg.startsWith('-'));
  const path = positional[packaged ? 0 : 1];
  if (!path) return null;
  return isAbsolute(path) ? path : resolve(cwd, path);
}
