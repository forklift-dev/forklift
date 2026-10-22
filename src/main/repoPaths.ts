import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

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
