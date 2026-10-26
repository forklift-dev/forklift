import type { CheckoutTarget } from '../../shared/branches';
import { t } from '../../shared/i18n';
import { GitCliError, type GitCli } from './cli';
import { RepoQueue } from './repoQueue';
import { StashService } from './stash';

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
    private readonly stashes = new StashService(git, queue),
  ) {}

  /** null when `name` is a valid new branch or tag name, else git's reason. */
  async invalidName(root: string, kind: 'branch' | 'tag', name: string): Promise<string | null> {
    if (name.trim() === '') return t('Enter a name');
    if (name.startsWith('-')) return t('A name cannot start with "-"');
    const args = kind === 'branch' ? ['check-ref-format', '--branch', name] : ['check-ref-format', `refs/tags/${name}`];
    const { exitCode } = await this.git.exec(args, { cwd: root, readOnly: true, allowedExitCodes: [1, 128] });
    return exitCode === 0 ? null : kind === 'branch' ? t('"{name}" is not a valid branch name', { name }) : t('"{name}" is not a valid tag name', { name });
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
      if (!local || !target.name.startsWith(`${target.remote}/`)) throw new BranchError(t('{name} is not a branch of {remote}', { name: target.name, remote: target.remote }));
      if (await this.exists(root, `refs/heads/${local}`)) {
        throw new BranchError(t('A local branch "{local}" already exists. Check it out, or create a branch with another name from {remote}.', { local, remote: target.name }));
      }
      return this.switchTo(root, ['-c', local, '--track', target.name], sha, local);
    });
  }

  /** The remote branch `name` tracks (pull and push go there, ahead/behind count against it); null stops tracking. */
  setUpstream(root: string, name: string, upstream: string | null): Promise<void> {
    return this.queue.run(root, async () => {
      await this.resolve(root, `refs/heads/${name}`);
      if (upstream === null) return this.exec(root, ['branch', '--unset-upstream', name]);
      await this.resolve(root, `refs/remotes/${upstream}`);
      // The full ref name: a local branch called "origin/x" cannot be mistaken for it.
      await this.exec(root, ['branch', `--set-upstream-to=refs/remotes/${upstream}`, name]);
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
    const stash = await this.stashes.pushNow(root, { message: label, includeUntracked: true, stagedOnly: false });
    if (!stash) {
      await this.exec(root, ['switch', ...args]);
      return { stash: 'none', message: null };
    }
    try {
      await this.exec(root, ['switch', ...args]);
    } catch (error) {
      // The switch did not happen: put the changes back where they were.
      await this.stashes.applyNow(root, stash, true);
      throw error;
    }
    const { outcome, detail } = await this.stashes.applyNow(root, stash, true);
    switch (outcome) {
      case 'applied':
        return { stash: 'restored', message: null };
      case 'applied-unstaged':
        return { stash: 'restored-unstaged', message: t('Switched to {target}. Your changes are back, but what was staged is now unstaged (it did not apply to the index here).', { target: description }) };
      case 'conflicts':
        return { stash: 'conflicts', message: t('Switched to {target}. Your uncommitted changes conflict with it in {detail}; resolve the conflicts. The changes are also kept in the stash "{stash}".', { target: description, detail: detail ?? '', stash: label }) };
      case 'failed':
        return { stash: 'kept', message: t('Switched to {target}, but your uncommitted changes could not be put back ({detail}). They are safe in the stash "{stash}".', { target: description, detail: detail ?? '', stash: label }) };
    }
  }

  private async resolve(root: string, ref: string): Promise<string> {
    const { exitCode, stdout } = await this.git.exec(['rev-parse', '--verify', '-q', `${ref}^{commit}`], { cwd: root, readOnly: true, allowedExitCodes: [1] });
    if (exitCode !== 0) throw new BranchError(t('{ref} does not exist', { ref: ref.replace(/^refs\/(heads|remotes|tags)\//, '') }));
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

function assertSha(sha: string): void {
  if (!SHA.test(sha)) throw new BranchError('A full commit hash is required');
}
