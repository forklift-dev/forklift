import { readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import type { WorktreeAddRequest, WorktreeInfo } from '../../shared/worktrees';
import type { GitCli } from './cli';
import { RepoQueue } from './repoQueue';

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorktreeError';
  }
}

const NAME = /^[^-\s][^\s]{0,254}$/;

/** Parses `git worktree list --porcelain`: blank-line separated records of "key value" lines. */
export function parseWorktreeList(output: string, root: string): WorktreeInfo[] {
  return output
    .split(/\n\n+/)
    .map((block) => block.split('\n').filter(Boolean))
    .filter((lines) => lines[0]?.startsWith('worktree '))
    .map((lines, index) => {
      const value = (key: string) => {
        const line = lines.find((l) => l === key || l.startsWith(`${key} `));
        return line === undefined ? null : line.slice(key.length + 1);
      };
      const path = value('worktree')!;
      const branch = value('branch');
      return {
        path,
        head: value('HEAD'),
        branch: branch ? branch.replace(/^refs\/heads\//, '') : null,
        bare: value('bare') !== null,
        main: index === 0,
        current: path === root,
        locked: value('locked'),
        prunable: value('prunable') !== null,
      };
    });
}

/** Linked working trees: list, add (for a branch, or a new one), remove, lock, prune. */
export class WorktreeService {
  constructor(
    private readonly git: GitCli,
    private readonly queue = new RepoQueue(),
  ) {}

  async list(root: string): Promise<WorktreeInfo[]> {
    const { stdout } = await this.git.exec(['worktree', 'list', '--porcelain'], { cwd: root, readOnly: true });
    // git prints real paths; the tab id may be a path through a symlink.
    const real = await realpath(root).catch(() => root);
    return parseWorktreeList(stdout, real).map((tree) => ({ ...tree, current: tree.path === real || tree.path === root }));
  }

  async add(root: string, request: unknown): Promise<string> {
    if (typeof request !== 'object' || request === null) throw new WorktreeError('Choose a folder and a branch');
    const { path, branch, newBranch } = request as Record<string, unknown> as Partial<WorktreeAddRequest>;
    if (typeof path !== 'string' || !isAbsolute(path) || /[\0\r\n]/.test(path)) throw new WorktreeError('Choose the folder for the working tree (a full path)');
    if (!(await stat(dirname(path)).then((info) => info.isDirectory(), () => false))) throw new WorktreeError(`${dirname(path)} is not an existing folder`);
    const existing = await stat(path).catch(() => null);
    if (existing && (!existing.isDirectory() || (await readdir(path)).length > 0)) throw new WorktreeError(`${path} already exists and is not empty`);
    const args = ['worktree', 'add'];
    if (newBranch !== null && newBranch !== undefined) {
      await this.assertBranchName(root, newBranch);
      args.push('-b', newBranch, '--', path);
    } else {
      if (typeof branch !== 'string' || !NAME.test(branch)) throw new WorktreeError('Choose a branch, or a name for a new one');
      args.push('--', path, branch);
    }
    return this.queue.run(root, async () => {
      await this.git.exec(args, { cwd: root });
      return path;
    });
  }

  /** `force`: also when it has uncommitted changes (they are lost). */
  async remove(root: string, path: unknown, force: boolean): Promise<void> {
    const tree = await this.find(root, path);
    if (tree.main) throw new WorktreeError('The main working tree cannot be removed');
    if (tree.current) throw new WorktreeError('Open another working tree to remove this one');
    await this.queue.run(root, () => this.git.exec(['worktree', 'remove', ...(force ? ['--force'] : []), '--', tree.path], { cwd: root }));
  }

  async lock(root: string, path: unknown, locked: boolean): Promise<void> {
    const tree = await this.find(root, path);
    if (tree.main) throw new WorktreeError('The main working tree cannot be locked');
    await this.queue.run(root, () => this.git.exec(['worktree', locked ? 'lock' : 'unlock', '--', tree.path], { cwd: root }));
  }

  /** Forgets working trees whose folders are gone. */
  async prune(root: string): Promise<void> {
    await this.queue.run(root, () => this.git.exec(['worktree', 'prune'], { cwd: root }));
  }

  private async find(root: string, path: unknown): Promise<WorktreeInfo> {
    if (typeof path !== 'string') throw new WorktreeError('Choose a working tree');
    const tree = (await this.list(root)).find((t) => t.path === path);
    if (!tree) throw new WorktreeError(`${path} is not a working tree of this repository`);
    return tree;
  }

  private async assertBranchName(root: string, name: unknown): Promise<void> {
    if (typeof name !== 'string' || !NAME.test(name)) throw new WorktreeError('Enter a branch name');
    const { exitCode } = await this.git.exec(['check-ref-format', '--branch', name], { cwd: root, readOnly: true, allowedExitCodes: [1, 128] });
    if (exitCode !== 0) throw new WorktreeError(`"${name}" is not a valid branch name`);
  }
}
