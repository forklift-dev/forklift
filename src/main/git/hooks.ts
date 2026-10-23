import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { HooksInfo } from '../../shared/hooks';
import type { GitCli } from './cli';

const CLIENT_HOOKS = new Set([
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'post-rewrite',
  'reference-transaction',
  'push-to-checkout',
  'pre-auto-gc',
  'fsmonitor-watchman',
  'post-index-change',
]);

/** Hooks git would run here: the hooks folder honours core.hooksPath (`rev-parse --git-path hooks`). */
export async function listHooks(git: GitCli, root: string): Promise<HooksInfo> {
  const { stdout } = await git.exec(['rev-parse', '--git-path', 'hooks'], { cwd: root, readOnly: true });
  const dir = isAbsolute(stdout.trim()) ? stdout.trim() : join(root, stdout.trim());
  const hooks: string[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!CLIENT_HOOKS.has(name)) continue;
    const info = await stat(join(dir, name)).catch(() => null);
    // Windows has no executable bit: git runs any hook file there.
    if (info?.isFile() && (process.platform === 'win32' || (info.mode & 0o111) !== 0)) hooks.push(name);
  }
  return { dir, hooks: hooks.sort() };
}
