import { GitCliError, isVersionAtLeast, type GitCli, type GitCliResult } from './cli';
import { RepoQueue } from './repoQueue';

/** How applying a stash went: cleanly, without its index, with conflicts, or not at all (stash kept). */
export interface ApplyOutcome {
  outcome: 'applied' | 'applied-unstaged' | 'conflicts' | 'failed';
  /** Conflicted paths for 'conflicts', git's reason for 'failed'. */
  detail: string | null;
}

export interface StashOptions {
  message: string;
  includeUntracked: boolean;
  /** Only what is staged (`git stash push --staged`, git 2.35+). */
  stagedOnly: boolean;
}

export class StashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StashError';
  }
}

/** `git stash push --staged` appeared in git 2.35. */
export const STAGED_STASH_GIT = '2.35.0';
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const output = (result: GitCliResult) => `${result.stdout}\n${result.stderr}`;

/**
 * Stashes through the git CLI. Stashes are named by their commit sha, not stash@{n}: positions shift
 * when another stash is made or dropped meanwhile, the sha does not.
 */
export class StashService {
  private gitVersion: Promise<string | null> | null = null;

  constructor(
    private readonly git: GitCli,
    private readonly queue = new RepoQueue(),
  ) {}

  /** Resolves to the new stash's sha, or null when there was nothing to stash. */
  push(root: string, options: StashOptions): Promise<string | null> {
    return this.queue.run(root, async () => {
      if (options.stagedOnly) {
        if (options.includeUntracked) throw new StashError('Untracked files cannot be stashed together with "only staged changes"');
        const version = await (this.gitVersion ??= this.git.version());
        if (!version || !isVersionAtLeast(version, STAGED_STASH_GIT)) {
          throw new StashError(`Stashing only staged changes needs git ${STAGED_STASH_GIT} or newer (this is ${version ?? 'unknown'})`);
        }
      }
      return this.pushNow(root, options);
    });
  }

  apply(root: string, sha: string, drop: boolean): Promise<ApplyOutcome> {
    return this.queue.run(root, () => this.applyNow(root, sha, drop));
  }

  drop(root: string, sha: string): Promise<void> {
    return this.queue.run(root, () => this.dropNow(root, sha));
  }

  /** Outside the queue, for callers already in it (switching branches). */
  async pushNow(root: string, options: StashOptions): Promise<string | null> {
    const before = await this.top(root);
    const args = ['stash', 'push'];
    if (options.includeUntracked) args.push('--include-untracked');
    if (options.stagedOnly) args.push('--staged');
    if (options.message.trim()) args.push('-m', options.message.trim());
    await this.exec(root, args);
    const after = await this.top(root);
    // "No local changes to save" exits 0 without a new stash.
    return after && after !== before ? after : null;
  }

  /** Applies with the index when possible; `drop` removes the stash only after a clean apply. */
  async applyNow(root: string, sha: string, drop: boolean): Promise<ApplyOutcome> {
    if (!SHA.test(sha)) throw new StashError('A stash commit hash is required');
    await this.position(root, sha);
    let result = await this.run(root, ['--index', sha]);
    let outcome: ApplyOutcome['outcome'] = 'applied';
    if (result.exitCode !== 0 && /Try without --index|Conflicts in index/i.test(output(result))) {
      result = await this.run(root, [sha]);
      outcome = 'applied-unstaged';
    }
    if (result.exitCode === 0) {
      if (drop) await this.dropNow(root, sha);
      return { outcome, detail: null };
    }
    const conflicts = [...output(result).matchAll(/CONFLICT \([^)]*\): .*? in (.+)$/gm)].map((match) => match[1]!.trim());
    if (conflicts.length) return { outcome: 'conflicts', detail: conflicts.join(', ') };
    const reason = output(result).split('\n').map((line) => line.trim()).find((line) => /^(error|fatal):/.test(line)) ?? 'git stash apply failed';
    return { outcome: 'failed', detail: reason.replace(/^(error|fatal):\s*/, '') };
  }

  async dropNow(root: string, sha: string): Promise<void> {
    await this.exec(root, ['stash', 'drop', '-q', `stash@{${await this.position(root, sha)}}`]);
  }

  /** `git stash drop` wants stash@{n}; find the stash's current position by its commit. */
  private async position(root: string, sha: string): Promise<number> {
    const { stdout } = await this.git.exec(['stash', 'list', '--format=%H'], { cwd: root, readOnly: true });
    const index = stdout.split('\n').indexOf(sha);
    if (index < 0) throw new StashError('This stash does not exist any more');
    return index;
  }

  private async top(root: string): Promise<string | null> {
    const { exitCode, stdout } = await this.git.exec(['rev-parse', '--verify', '-q', 'refs/stash'], { cwd: root, readOnly: true, allowedExitCodes: [1] });
    return exitCode === 0 ? stdout.trim() : null;
  }

  private run(root: string, args: string[]): Promise<GitCliResult> {
    return this.git.exec(['stash', 'apply', ...args], { cwd: root, allowedExitCodes: [1] });
  }

  private async exec(root: string, args: string[]): Promise<void> {
    try {
      await this.git.exec(args, { cwd: root });
    } catch (error) {
      if (error instanceof GitCliError) throw new StashError(error.message.replace(/^git .*? failed: (error: |fatal: )?/, ''));
      throw error;
    }
  }
}
