import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { AskpassServer } from '../askpass/server';
import { GitCliError, type GitCli } from './cli';
import type { CommitOpResult } from './commitOps';
import { RepoQueue } from './repoQueue';

export interface RemoteProgress {
  /** git's phase name: "Receiving objects", "Writing objects", … */
  phase: string;
  percent: number | null;
}

export interface RemoteRun {
  signal: AbortSignal;
  onProgress(progress: RemoteProgress): void;
}

export class RemoteError extends Error {
  /** The remote refused a push because it has commits the local branch lacks. */
  readonly rejected: boolean;
  constructor(message: string, rejected = false) {
    super(message);
    this.name = 'RemoteError';
    this.rejected = rejected;
  }
}

/** "Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s" → { phase, percent }. */
export function parseProgress(line: string): RemoteProgress | null {
  const match = /^(?:remote: )?([A-Za-z][A-Za-z ]*[A-Za-z]):\s+(\d{1,3})%/.exec(line.trim());
  return match ? { phase: match[1]!, percent: Number(match[2]) } : null;
}

const NAME = /^[^-\s][^\s]{0,254}$/;

/**
 * fetch, pull and push through the git CLI with progress, cancellation and credential prompts in the app.
 * Credentials come from the user's credential helper first; otherwise git asks through the askpass bridge.
 */
export class RemoteService {
  constructor(
    private readonly git: GitCli,
    private readonly askpass: Pick<AskpassServer, 'session'>,
    private readonly queue = new RepoQueue(),
  ) {}

  /**
   * `remote` null fetches every remote. Not `interactive` (auto-fetch): nobody is asked for credentials —
   * stored ones (credential helper, ssh-agent) work, anything else fails quietly.
   */
  fetch(root: string, remote: string | null, prune: boolean, run: RemoteRun, interactive = true): Promise<void> {
    if (remote !== null) assertName(remote, 'remote');
    const args = ['fetch', '--progress', ...(prune ? ['--prune'] : []), ...(remote ? [remote] : ['--all'])];
    return this.network(root, args, run, interactive).then(() => {});
  }

  addRemote(root: string, name: string, url: string): Promise<void> {
    return this.queue.run(root, async () => {
      await this.assertRemoteName(root, name);
      await this.admin(root, ['remote', 'add', name, parseUrl(url)]);
    });
  }

  renameRemote(root: string, from: string, to: string): Promise<void> {
    return this.queue.run(root, async () => {
      assertName(from, 'remote');
      await this.assertRemoteName(root, to);
      await this.admin(root, ['remote', 'rename', from, to]);
    });
  }

  /** Changes the fetch URL, or with `push` only the push URL (an empty push URL removes it again). */
  setRemoteUrl(root: string, name: string, url: string, push: boolean): Promise<void> {
    return this.queue.run(root, async () => {
      assertName(name, 'remote');
      if (push && url === '') {
        await this.git.exec(['config', '--unset-all', `remote.${name}.pushurl`], { cwd: root, allowedExitCodes: [5] });
        return;
      }
      await this.admin(root, ['remote', 'set-url', ...(push ? ['--push'] : []), name, parseUrl(url)]);
    });
  }

  /** Removes the remote and its remote-tracking branches (local branches are untouched). */
  removeRemote(root: string, name: string): Promise<void> {
    return this.queue.run(root, async () => {
      assertName(name, 'remote');
      await this.admin(root, ['remote', 'remove', name]);
    });
  }

  private async assertRemoteName(root: string, name: string): Promise<void> {
    assertName(name, 'remote');
    const { exitCode } = await this.git.exec(['check-ref-format', `refs/remotes/${name}/x`], { cwd: root, readOnly: true, allowedExitCodes: [1] });
    if (exitCode !== 0 || name.includes('/')) throw new RemoteError(`"${name}" is not a valid remote name`);
  }

  private async admin(root: string, args: string[]): Promise<void> {
    try {
      await this.git.exec(args, { cwd: root });
    } catch (error) {
      if (error instanceof GitCliError) throw new RemoteError(error.message.replace(/^git .*? failed: (error: |fatal: )?/, ''));
      throw error;
    }
  }

  /**
   * Pulls into the current branch: merge or rebase (owner's decision: both, chosen in the UI; the default
   * follows pull.rebase). Uncommitted changes are stashed around it.
   */
  pull(root: string, rebase: boolean, run: RemoteRun): Promise<CommitOpResult> {
    return this.queue.run(root, async () => {
      const args = ['pull', '--progress', '--autostash', rebase ? '--rebase' : '--no-rebase'];
      try {
        await this.network(root, args, run);
        return 'done';
      } catch (error) {
        // Conflicts leave a merge or rebase in progress: the operation banner takes over.
        const gitDir = (await this.git.exec(['rev-parse', '--absolute-git-dir'], { cwd: root, readOnly: true })).stdout.trim();
        for (const state of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply']) {
          if (await access(join(gitDir, state)).then(() => true, () => false)) return 'conflicts';
        }
        throw error;
      }
    });
  }

  /**
   * Pushes the current branch to its upstream, or to `remote` (setting it as upstream) when it has none.
   * `force` uses --force-with-lease: it refuses if the remote moved since it was last fetched.
   */
  async push(root: string, remote: string | null, force: boolean, run: RemoteRun): Promise<void> {
    if (remote !== null) assertName(remote, 'remote');
    const branch = (await this.git.exec(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root, readOnly: true, allowedExitCodes: [1] })).stdout.trim();
    if (!branch) throw new RemoteError('HEAD is detached: check out a branch to push it');
    const upstream = await this.git.exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd: root, readOnly: true, allowedExitCodes: [128] });
    const args = ['push', '--progress', '--porcelain', ...(force ? ['--force-with-lease'] : [])];
    if (upstream.exitCode !== 0) {
      if (!remote) throw new RemoteError(`${branch} has no upstream branch: choose a remote to push it to`);
      args.push('--set-upstream', remote, `refs/heads/${branch}:refs/heads/${branch}`);
    }
    await this.network(root, args, run);
  }

  /**
   * Clones `url` into `target` (a new or empty folder inside `parent`). Credential prompts belong to no tab.
   * On failure or cancellation git removes what it created; the caller cleans up after a killed git.
   */
  async clone(parent: string, url: string, target: string, run: RemoteRun): Promise<void> {
    await this.network(parent, ['clone', '--progress', '--', parseUrl(url), target], run, true, null);
  }

  private async network(root: string, args: string[], run: RemoteRun, interactive = true, promptRepo: string | null = root): Promise<string> {
    // In the background nothing may ask: an empty askpass fails at once, and ssh is told never to ask.
    const session = interactive
      ? this.askpass.session(promptRepo)
      : { env: { GIT_ASKPASS: '', SSH_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never' }, dispose: () => {} };
    // Cancelling the operation also withdraws its open credential prompts.
    run.signal.addEventListener('abort', () => session.dispose(), { once: true });
    try {
      const { stdout } = await this.git.exec(args, {
        cwd: root,
        env: session.env,
        signal: run.signal,
        onStderrLine: (line) => {
          const progress = parseProgress(line);
          if (progress) run.onProgress(progress);
        },
      });
      return stdout;
    } catch (error) {
      if (!(error instanceof GitCliError)) throw error;
      const output = `${error.stderr}\n${error.stdout}`;
      const lines = output.split('\n').map((line) => line.trim()).filter((line) => line && !parseProgress(line) && !line.startsWith('hint:'));
      const rejected = /\[rejected\]|non-fast-forward|fetch first|stale info/i.test(output);
      const reason = lines.filter((line) => /^(fatal|error|!|remote: error)/.test(line) || /rejected|denied|failed/i.test(line)).slice(0, 8);
      throw new RemoteError((reason.length ? reason : lines.slice(-6)).join('\n').replace(/^(fatal|error): /gm, '') || error.message, rejected);
    } finally {
      session.dispose();
    }
  }
}

function parseUrl(url: string): string {
  if (typeof url !== 'string' || !url.trim() || url.length > 4096 || /[\0\r\n]/.test(url) || url.trim().startsWith('-')) {
    throw new RemoteError('Enter a repository URL or path');
  }
  return url.trim();
}

function assertName(name: string, what: string): void {
  if (!NAME.test(name)) throw new RemoteError(`"${name}" is not a valid ${what} name`);
}
