import { realpath } from 'node:fs/promises';
import { isAbsolute, posix, resolve, sep, win32 } from 'node:path';

/**
 * Validates a repo-relative path without touching the disk (it may name a deleted file) and
 * returns it in git's forward-slash form. Rejects absolute paths and anything climbing out.
 */
export function normalizeRepoRelative(path: string): string {
  if (isAbsolute(path) || win32.isAbsolute(path)) throw new Error('Path must be relative to the repository');
  const normalized = posix.normalize(path.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.' || normalized === '') {
    throw new Error('Path is outside the repository');
  }
  return normalized;
}

/**
 * Resolves a renderer-supplied, repo-relative path and refuses anything that escapes the
 * repository, including through symlinks (both sides are compared after realpath).
 */
export async function resolveInsideRepo(root: string, relativePath: string): Promise<string> {
  if (isAbsolute(relativePath)) throw new Error('Path must be relative to the repository');
  const realRoot = await realpath(root);
  const target = await realpath(resolve(realRoot, relativePath)).catch(() => {
    throw new Error(`${relativePath} does not exist in the working tree`);
  });
  if (target !== realRoot && !target.startsWith(realRoot + sep)) throw new Error('Path is outside the repository');
  return target;
}
