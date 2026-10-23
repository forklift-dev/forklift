import type { GitCli } from './cli';

const MAX_FILES = 200_000;

/** Tracked and untracked (not ignored) files of the working tree, relative to the root, for the finder. */
export async function listFiles(git: GitCli, root: string): Promise<{ paths: string[]; truncated: boolean }> {
  const { stdout } = await git.exec(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, readOnly: true, timeoutMs: 60_000 });
  // A conflicted file is listed once per stage (--deduplicate needs git 2.31).
  const paths = [...new Set(stdout.split('\0').filter(Boolean))];
  return { paths: paths.slice(0, MAX_FILES), truncated: paths.length > MAX_FILES };
}
