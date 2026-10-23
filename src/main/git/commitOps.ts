import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { GitCliError, type GitCli } from './cli';
import { RepoQueue } from './repoQueue';

export type ResetMode = 'soft' | 'mixed' | 'hard';
/** `conflicts`: git stopped to let the user resolve them (the operation banner takes over). */
export type CommitOpResult = 'done' | 'conflicts';

export class CommitOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommitOpError';
  }
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;

/** Cherry-pick, revert and reset of single commits, through the git CLI (hooks and git's own checks apply). */
export class CommitOps {
  constructor(
    private readonly git: GitCli,
    private readonly queue = new RepoQueue(),
  ) {}

  cherryPick(root: string, sha: string): Promise<CommitOpResult> {
    return this.queue.run(root, () => this.apply(root, 'cherry-pick', sha, 'CHERRY_PICK_HEAD'));
  }

  /** A new commit that undoes `sha`; the message is git's "Revert ..." one. */
  revert(root: string, sha: string): Promise<CommitOpResult> {
    return this.queue.run(root, () => this.apply(root, 'revert', sha, 'REVERT_HEAD'));
  }

  /** Moves the current branch (or detached HEAD) to `sha`: soft keeps changes staged, mixed unstaged, hard discards them. */
  reset(root: string, sha: string, mode: ResetMode): Promise<void> {
    return this.queue.run(root, async () => {
      assertSha(sha);
      await this.run(root, ['reset', '-q', `--${mode}`, sha]);
    });
  }

  private async apply(root: string, command: 'cherry-pick' | 'revert', sha: string, stateFile: string): Promise<CommitOpResult> {
    assertSha(sha);
    // A merge commit is applied relative to its first parent (the branch it was merged into).
    const parents = (await this.git.exec(['rev-list', '--parents', '-n', '1', sha], { cwd: root, readOnly: true })).stdout.trim().split(' ').length - 1;
    const args = [command, ...(command === 'revert' ? ['--no-edit'] : []), ...(parents > 1 ? ['-m', '1'] : []), sha];
    try {
      await this.git.exec(args, { cwd: root });
      return 'done';
    } catch (error) {
      if (!(error instanceof GitCliError)) throw error;
      const gitDir = (await this.git.exec(['rev-parse', '--absolute-git-dir'], { cwd: root, readOnly: true })).stdout.trim();
      if (await access(join(gitDir, stateFile)).then(() => true, () => false)) {
        // Stopped on conflicts — or with nothing left to commit (already applied); the banner offers what fits.
        return 'conflicts';
      }
      throw new CommitOpError(message(error));
    }
  }

  private async run(root: string, args: string[]): Promise<void> {
    try {
      await this.git.exec(args, { cwd: root });
    } catch (error) {
      if (error instanceof GitCliError) throw new CommitOpError(message(error));
      throw error;
    }
  }
}

const message = (error: GitCliError) => {
  const output = `${error.stderr}\n${error.stdout}`.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('hint:'));
  return output.length ? output.slice(0, 12).join('\n').replace(/^(error|fatal): /gm, '') : error.message;
};

function assertSha(sha: string): void {
  if (!SHA.test(sha)) throw new CommitOpError('A full commit hash is required');
}
