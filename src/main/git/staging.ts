import { lstat, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileVersion } from '../../shared/diff';
import type { LineActionRequest } from '../../shared/staging';
import { GitCliError, type GitCli } from './cli';
import { applyLineChanges, dominantEol, splitLines } from './partial';
import type { GitService } from './service';
import { RepoQueue } from './repoQueue';

export class StagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StagingError';
  }
}

/** How many lines of git/hook output a failed commit reports. */
const COMMIT_OUTPUT_LINES = 40;

/**
 * Index and working-tree changes: whole files through git commands, single lines by rebuilding the
 * file text and writing it with `git hash-object` (which applies the same filters `git add` would).
 * Operations on one repository run one at a time so they never race for index.lock.
 */
export class StagingService {
  constructor(
    private readonly git: GitCli,
    private readonly reader: Pick<GitService, 'fileDiff'>,
    /** Shared with other services that write the repository. */
    private readonly queue = new RepoQueue(),
  ) {}

  stageFiles(root: string, paths: readonly string[]): Promise<void> {
    // -A also records deletions of the given paths.
    return this.serial(root, () => this.exec(root, ['add', '-A', '--', ...paths]));
  }

  /** `unborn`: no commit yet, so there is no HEAD to restore the index from. */
  unstageFiles(root: string, paths: readonly string[], unborn: boolean): Promise<void> {
    return this.serial(root, () =>
      unborn
        ? this.exec(root, ['rm', '--cached', '-r', '-q', '--', ...paths])
        : this.exec(root, ['restore', '--staged', '--', ...paths]),
    );
  }

  /** Reverts tracked files to their index version and deletes untracked ones. */
  discardFiles(root: string, tracked: readonly string[], untracked: readonly string[]): Promise<void> {
    return this.serial(root, async () => {
      if (tracked.length) await this.exec(root, ['restore', '--worktree', '--', ...tracked]);
      for (const path of untracked) await rm(join(root, path), { force: true });
    });
  }

  applyLines(root: string, request: LineActionRequest): Promise<void> {
    return this.serial(root, () => this.applyLinesNow(root, request));
  }

  /**
   * Commits the index with hooks and signing as configured; returns the new HEAD. `skipHooks` is
   * `--no-verify` (pre-commit and commit-msg do not run); `onOutput` gets hook and git output as it comes.
   */
  commit(root: string, message: string, amend: boolean, options: { skipHooks?: boolean; onOutput?(line: string): void } = {}): Promise<string> {
    return this.serial(root, async () => {
      try {
        await this.git.exec(['commit', '--file=-', ...(amend ? ['--amend'] : []), ...(options.skipHooks ? ['--no-verify'] : [])], {
          cwd: root,
          input: message,
          onStdoutLine: options.onOutput,
          onStderrLine: options.onOutput,
        });
      } catch (error) {
        if (!(error instanceof GitCliError) || error.exitCode === null) throw error;
        // Hook output is what the user needs here, not just git's last line.
        const output = `${error.stdout}\n${error.stderr}`.trim().split(/\r?\n/).slice(-COMMIT_OUTPUT_LINES).join('\n');
        throw new StagingError(`Commit failed:\n${output || error.message}`);
      }
      return (await this.git.exec(['rev-parse', 'HEAD'], { cwd: root, readOnly: true })).stdout.trim();
    });
  }

  private async applyLinesNow(root: string, request: LineActionRequest): Promise<void> {
    const { path, action } = request;
    const { original, modified } = await this.reader.fileDiff(root, { kind: 'worktree', path, staged: action === 'unstage' });
    if (original.hash !== request.originalHash || modified.hash !== request.modifiedHash) {
      throw new StagingError(`${path} changed since it was shown; review the updated diff and try again`);
    }
    assertEditable(original, path);
    assertEditable(modified, path);
    if (!modified.exists) throw new StagingError(`${path} was deleted; stage or discard the whole file instead`);
    // Symlinks and submodules are not text files: writing "lines" would replace them with regular files.
    const onDisk = await lstat(join(root, path)).catch(() => null);
    if (onDisk?.isSymbolicLink() || onDisk?.isDirectory()) {
      throw new StagingError(`${path} is a symlink or submodule; stage or discard it as a whole`);
    }
    await this.assertNoFilter(root, path);

    const picked = {
      original: new Set(request.selectedOriginal),
      modified: new Set(request.selectedModified),
    };
    // stage: index + picked; unstage: HEAD + everything except picked; discard: index + everything except picked.
    const keepPicked = action === 'stage';
    const pick = {
      original: (line: number) => picked.original.has(line) === keepPicked,
      modified: (line: number) => picked.modified.has(line) === keepPicked,
    };
    const originalText = original.text ?? '';
    const modifiedText = modified.text ?? '';

    if (action === 'discard') {
      // Lines brought back from the index take the checkout's line endings (autocrlf), like a checkout would.
      const worktreeEol = dominantEol(splitLines(modifiedText));
      const indexEol = dominantEol(splitLines(originalText));
      const eol = worktreeEol && indexEol && worktreeEol !== indexEol ? worktreeEol : undefined;
      const text = applyLineChanges(originalText, modifiedText, request.changes, pick, eol);
      await writeFile(join(root, path), text);
      return;
    }

    const text = applyLineChanges(originalText, modifiedText, request.changes, pick);
    const mode = await this.indexMode(root, path);
    if (mode === '120000' || mode === '160000') throw new StagingError(`${path} is a symlink or submodule; stage it as a whole`);
    // Working-tree text goes through the clean filters (autocrlf, eol, ident) exactly as `git add` would;
    // HEAD/index text is already clean.
    const filters = action === 'stage' ? [`--path=${path}`] : ['--no-filters'];
    const { stdout } = await this.git.exec(['hash-object', '-w', '--stdin', ...filters], { cwd: root, input: text });
    await this.exec(root, ['update-index', '--add', '--cacheinfo', `${mode},${stdout.trim()},${path}`]);
  }

  /** Mode of the index entry, or of the working-tree file for a path not in the index yet. */
  private async indexMode(root: string, path: string): Promise<string> {
    const { stdout } = await this.git.exec(['ls-files', '--stage', '--', path], { cwd: root, readOnly: true });
    const mode = /^(\d{6}) /.exec(stdout)?.[1];
    if (mode) return mode;
    const stats = await lstat(join(root, path));
    return stats.mode & 0o111 ? '100755' : '100644';
  }

  /** Partial staging of filtered files (LFS and other `filter=` attributes) would write the wrong content. */
  private async assertNoFilter(root: string, path: string): Promise<void> {
    const { stdout } = await this.git.exec(['check-attr', 'filter', '--', path], { cwd: root, readOnly: true });
    const value = stdout.trim().split(': ').pop();
    if (value && value !== 'unspecified' && value !== 'unset') {
      throw new StagingError(`${path} uses the "${value}" filter; stage or discard the whole file instead`);
    }
  }

  private async exec(root: string, args: string[]): Promise<void> {
    await this.git.exec(args, { cwd: root });
  }

  private serial<T>(root: string, task: () => Promise<T>): Promise<T> {
    return this.queue.run(root, task);
  }
}

function assertEditable(version: FileVersion, path: string): void {
  if (version.binary) throw new StagingError(`${path} is binary; stage or discard the whole file instead`);
  if (version.tooLarge) throw new StagingError(`${path} is too large for line staging; use the whole file`);
  if (version.lossy) throw new StagingError(`${path} is not valid UTF-8; stage or discard the whole file instead`);
}
