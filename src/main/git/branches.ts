import type { CheckoutTarget } from '../../shared/branches';
import { GitCliError, type GitCli, type GitCliResult } from './cli';
import { RepoQueue } from './repoQueue';

/** What happened to uncommitted changes around a switch; `message` explains anything but a clean outcome. */
export interface SwitchResult {
  stash: 'none' | 'restored' | 'restored-unstaged' | 'conflicts' | 'kept';
  message: string | null;
}

export class BranchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BranchError';
  }
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;

/** Branches, tags and switching between them, through the git CLI (hooks, LFS and sparse checkout apply). */
export class BranchService {
  constructor(
    private readonly git: GitCli,
    private readonly queue = new RepoQueue(),
  ) {}

  /** null when `name` is a valid new branch or tag name, else git's reason. */
  async invalidName(root: string, kind: 'branch' | 'tag', name: string): Promise<string | null> {
    if (name.trim() === '') return 'Enter a name';
    if (name.startsWith('-')) return 'A name cannot start with "-"';
    const args = kind === 'branch' ? ['check-ref-format', '--branch', name] : ['check-ref-format', `refs/tags/${name}`];
    const { exitCode } = await this.git.exec(args, { cwd: root, readOnly: true, allowedExitCodes: [1, 128] });
    return exitCode === 0 ? null : `"${name}" is not a valid ${kind} name`;
  }

  /** Creates a branch at a commit; with `checkout`, switches to it (carrying uncommitted changes along). */
  create(root: string, name: string, sha: string, checkout: boolean): Promise<SwitchResult> {
    return this.queue.run(root, async () => {
      await this.assertValid(root, 'branch', name);
      assertSha(sha);
      if (!checkout) {
        await this.exec(root, ['branch', name, sha]);
        return { stash: 'none', message: null };
      }
      return this.switchTo(root, ['-c', name, sha], sha, name);
    });
  }

  /** Switches to a local branch, a remote branch (creating a local tracking branch) or a commit (detached). */
  checkout(root: string, target: CheckoutTarget): Promise<SwitchResult> {
    return this.queue.run(root, async () => {
      if (target.kind === 'commit') {
        assertSha(target.sha);
        return this.switchTo(root, ['--detach', target.sha], target.sha, target.sha.slice(0, 7));
      }
      if (target.kind === 'branch') {
        const sha = await this.resolve(root, `refs/heads/${target.name}`);
        return this.switchTo(root, [target.name], sha, target.name);
      }
      const remoteRef = `refs/remotes/${target.name}`;
      const sha = await this.resolve(root, remoteRef);
      const local = target.name.slice(target.remote.length + 1);
      if (!local || !target.name.startsWith(`${target.remote}/`)) throw new BranchError(`${target.name} is not a branch of ${target.remote}`);
      if (await this.exists(root, `refs/heads/${local}`)) {
        throw new BranchError(`A local branch "${local}" already exists. Check it out, or create a branch with another name from ${target.name}.`);
      }
      return this.switchTo(root, ['-c', local, '--track', target.name], sha, local);
    });
  }

  rename(root: string, from: string, to: string): Promise<void> {
    return this.queue.run(root, async () => {
      await this.resolve(root, `refs/heads/${from}`);
      await this.assertValid(root, 'branch', to);
      await this.exec(root, ['branch', '-m', from, to]);
    });
  }

  /** Without `force`, git refuses to delete a branch whose commits are not merged anywhere. */
  delete(root: string, name: string, force: boolean): Promise<void> {
    return this.queue.run(root, async () => {
      await this.resolve(root, `refs/heads/${name}`);
      await this.exec(root, ['branch', force ? '-D' : '-d', name]);
    });
  }

  createTag(root: string, name: string, sha: string, message: string | null): Promise<void> {
    return this.queue.run(root, async () => {
      await this.assertValid(root, 'tag', name);
      assertSha(sha);
      // An annotated tag records who tagged and why; the message goes through stdin, never the command line.
      if (message) await this.git.exec(['tag', '-a', name, '-F', '-', sha], { cwd: root, input: message });
      else await this.exec(root, ['tag', name, sha]);
    });
  }

  deleteTag(root: string, name: string): Promise<void> {
    return this.queue.run(root, async () => {
      await this.resolve(root, `refs/tags/${name}`);
      await this.exec(root, ['tag', '-d', name]);
    });
  }

  /**
   * Owner's decision (2026-10-22): switching with uncommitted changes stashes them, switches and brings
   * them back. A conflict on the way back leaves the stash in place and the conflict to resolve.
   */
  private async switchTo(root: string, args: string[], targetSha: string, description: string): Promise<SwitchResult> {
    const head = await this.git.exec(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: root, readOnly: true, allowedExitCodes: [1] });
    const status = await this.git.exec(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, readOnly: true });
    // Staying on the same commit (a new branch at HEAD) carries changes over without touching them.
    if (status.stdout.trim() === '' || head.stdout.trim() === targetSha) {
      await this.exec(root, ['switch', ...args]);
      return { stash: 'none', message: null };
    }

    const label = `Forklift: changes from before switching to ${description}`;
    await this.exec(root, ['stash', 'push', '--include-untracked', '-m', label]);
    const stash = (await this.git.exec(['rev-parse', 'stash@{0}'], { cwd: root, readOnly: true })).stdout.trim();
    try {
      await this.exec(root, ['switch', ...args]);
    } catch (error) {
      // The switch did not happen: put the changes back where they were.
      await this.restore(root, stash);
      throw error;
    }
    const result = await this.restore(root, stash);
    if (result.stash === 'conflicts') {
      result.message = `Switched to ${description}. Your uncommitted changes conflict with it in ${result.message}; resolve the conflicts. The changes are also kept in the stash "${label}".`;
    } else if (result.stash === 'kept') {
      result.message = `Switched to ${description}, but your uncommitted changes could not be put back (${result.message}). They are safe in the stash "${label}".`;
    } else if (result.stash === 'restored-unstaged') {
      result.message = `Switched to ${description}. Your changes are back, but what was staged is now unstaged (it did not apply to the index here).`;
    }
    return result;
  }

  /** Applies a stash (with its index if possible) and drops it when it applied cleanly. */
  private async restore(root: string, stash: string): Promise<SwitchResult> {
    let result = await this.apply(root, ['--index', stash]);
    let outcome: SwitchResult['stash'] = 'restored';
    if (result.exitCode !== 0 && /Try without --index|Conflicts in index/i.test(output(result))) {
      result = await this.apply(root, [stash]);
      outcome = 'restored-unstaged';
    }
    if (result.exitCode === 0) {
      await this.drop(root, stash);
      return { stash: outcome, message: null };
    }
    const conflicts = [...output(result).matchAll(/CONFLICT \([^)]*\): .*? in (.+)$/gm)].map((match) => match[1]!.trim());
    if (conflicts.length) return { stash: 'conflicts', message: conflicts.join(', ') };
    const reason = output(result).split('\n').map((line) => line.trim()).find((line) => /^(error|fatal):/.test(line)) ?? 'git stash apply failed';
    return { stash: 'kept', message: reason.replace(/^(error|fatal):\s*/, '') };
  }

  private apply(root: string, args: string[]): Promise<GitCliResult> {
    return this.git.exec(['stash', 'apply', ...args], { cwd: root, allowedExitCodes: [1] });
  }

  /** `git stash drop` takes a stash@{n} reference, so find the stash's position by its commit. */
  private async drop(root: string, stash: string): Promise<void> {
    const { stdout } = await this.git.exec(['stash', 'list', '--format=%H'], { cwd: root, readOnly: true });
    const index = stdout.split('\n').indexOf(stash);
    if (index >= 0) await this.exec(root, ['stash', 'drop', '-q', `stash@{${index}}`]);
  }

  private async resolve(root: string, ref: string): Promise<string> {
    const { exitCode, stdout } = await this.git.exec(['rev-parse', '--verify', '-q', `${ref}^{commit}`], { cwd: root, readOnly: true, allowedExitCodes: [1] });
    if (exitCode !== 0) throw new BranchError(`${ref.replace(/^refs\/(heads|remotes|tags)\//, '')} does not exist`);
    return stdout.trim();
  }

  private async exists(root: string, ref: string): Promise<boolean> {
    const { exitCode } = await this.git.exec(['rev-parse', '--verify', '-q', ref], { cwd: root, readOnly: true, allowedExitCodes: [1] });
    return exitCode === 0;
  }

  private async assertValid(root: string, kind: 'branch' | 'tag', name: string): Promise<void> {
    const problem = await this.invalidName(root, kind, name);
    if (problem) throw new BranchError(problem);
  }

  private async exec(root: string, args: string[]): Promise<void> {
    try {
      await this.git.exec(args, { cwd: root });
    } catch (error) {
      if (error instanceof GitCliError) throw new BranchError(error.message.replace(/^git .*? failed: (error: |fatal: )?/, ''));
      throw error;
    }
  }
}

const output = (result: GitCliResult) => `${result.stdout}\n${result.stderr}`;

function assertSha(sha: string): void {
  if (!SHA.test(sha)) throw new BranchError('A full commit hash is required');
}
