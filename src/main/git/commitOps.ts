import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { GitCliError, type GitCli } from './cli';
import { RepoQueue } from './repoQueue';

export type ResetMode = 'soft' | 'mixed' | 'hard';
/** default: fast-forward when possible; no-ff: always a merge commit; squash: the changes staged, not committed. */
export type MergeMode = 'default' | 'no-ff' | 'ff-only' | 'squash';
/** `conflicts`: git stopped to let the user resolve them (the operation banner takes over). */
export type CommitOpResult = 'done' | 'conflicts';

export class CommitOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommitOpError';
  }
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const MERGE_FLAGS: Record<MergeMode, string[]> = { default: ['--no-edit'], 'no-ff': ['--no-ff', '--no-edit'], 'ff-only': ['--ff-only'], squash: ['--squash'] };

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

  /**
   * Merges `ref` (a branch, remote branch or commit) into the current branch. Uncommitted changes are stashed
   * and restored around it (`--autostash`), as GitKraken does before such operations.
   */
  merge(root: string, ref: string, mode: MergeMode, message: string | null): Promise<CommitOpResult> {
    return this.queue.run(root, async () => {
      await this.assertRef(root, ref);
      const args = ['merge', '--autostash', ...MERGE_FLAGS[mode]];
      // An argument, never through a shell, so any text is safe here.
      if (message?.trim() && mode !== 'squash' && mode !== 'ff-only') args.push('-m', message.trim());
      return this.stopOrDone(root, [...args, ref], 'MERGE_HEAD', mode === 'squash');
    });
  }

  /** Rebases the current branch onto `onto`, uncommitted changes stashed and restored around it. */
  rebase(root: string, onto: string): Promise<CommitOpResult> {
    return this.queue.run(root, async () => {
      await this.assertRef(root, onto);
      return this.stopOrDone(root, ['rebase', '--autostash', onto], 'rebase-merge');
    });
  }

  private async stopOrDone(root: string, args: string[], stateFile: string, conflictsWithoutState = false): Promise<CommitOpResult> {
    try {
      await this.git.exec(args, { cwd: root });
      return 'done';
    } catch (error) {
      if (!(error instanceof GitCliError)) throw error;
      const gitDir = (await this.git.exec(['rev-parse', '--absolute-git-dir'], { cwd: root, readOnly: true })).stdout.trim();
      const stopped = (await access(join(gitDir, stateFile)).then(() => true, () => false)) || (await access(join(gitDir, 'rebase-apply')).then(() => true, () => false));
      // A squash merge with conflicts leaves no MERGE_HEAD: conflicted files are the sign.
      const conflicted = conflictsWithoutState && /CONFLICT/.test(`${error.stdout}\n${error.stderr}`);
      if (stopped || conflicted) return 'conflicts';
      throw new CommitOpError(message(error));
    }
  }

  private async assertRef(root: string, ref: string): Promise<void> {
    if (ref.startsWith('-') || ref.length > 255) throw new CommitOpError(`"${ref}" is not a branch or commit`);
    const { exitCode } = await this.git.exec(['rev-parse', '--verify', '-q', `${ref}^{commit}`], { cwd: root, readOnly: true, allowedExitCodes: [1] });
    if (exitCode !== 0) throw new CommitOpError(`${ref} does not exist`);
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
