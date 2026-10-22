import { basename, dirname } from 'node:path';
import findGitRepos from 'find-git-repositories';

type FindGitRepos = typeof findGitRepos;

const MAX_RESULTS = 2000;

/**
 * Finds git repositories under a folder (native, off the main thread); one search at a time, cancellable.
 * It does not descend into a repository it found, and linked worktrees (`.git` file) are not reported.
 */
export class RepoScanner {
  private cancelCurrent: (() => void) | null = null;

  constructor(private readonly find: FindGitRepos = findGitRepos) {}

  /** Resolves with repository roots, sorted; a newer search or cancel() ends this one early with what it found. */
  async scan(folder: string, maxDepth = 6): Promise<string[]> {
    this.cancel();
    let cancelled = false;
    this.cancelCurrent = () => (cancelled = true);
    const found = new Set<string>();
    const add = (paths: string[]) => {
      for (const path of paths) if (found.size < MAX_RESULTS) found.add(basename(path) === '.git' ? dirname(path) : path);
    };
    try {
      // Returning true from the progress callback stops the native search.
      add(await this.find(folder, (paths) => (add(paths), cancelled || found.size >= MAX_RESULTS), { throttleTimeoutMS: 100, maxSubfolderDeep: maxDepth }));
    } finally {
      if (!cancelled) this.cancelCurrent = null;
    }
    return [...found].sort((a, b) => a.localeCompare(b));
  }

  cancel(): void {
    this.cancelCurrent?.();
    this.cancelCurrent = null;
  }
}
