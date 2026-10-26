import { cp, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CheckoutTarget } from '../../shared/branches';
import { t } from '../../shared/i18n';
import type { BranchService } from './branches';
import type { GitCli } from './cli';
import type { RepoQueue } from './repoQueue';
import type { StagingService } from './staging';
import type { StashService } from './stash';

/** One thing an undo or redo does. Data only, so entries are easy to inspect and test. */
export type UndoStep =
  | { kind: 'git'; args: string[] }
  | { kind: 'checkout'; target: CheckoutTarget }
  | { kind: 'restoreFiles'; from: string; paths: string[] }
  | { kind: 'discard'; tracked: string[]; untracked: string[] }
  | { kind: 'stashApply'; sha: string; drop: boolean }
  | { kind: 'stashDrop'; sha: string };

/** What must hold before a step list may run: otherwise the repository changed in between. */
export interface Expectation {
  head?: string | null;
  branch?: string | null;
  /** Full ref name → sha it must point at (null: must not exist). */
  refs?: Record<string, string | null>;
}

export interface UndoEntry {
  label: string;
  undo: UndoStep[];
  /** null: cannot be redone (e.g. a stash pop would need the same stash again). */
  redo: UndoStep[] | null;
  /** State right after the action (needed to undo it). */
  after: Expectation;
  /** State right before it (needed to redo it). */
  before: Expectation;
}

export interface RepoPosition {
  head: string | null;
  branch: string | null;
}

export class UndoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UndoError';
  }
}

const MAX_SAVED_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 50;

/**
 * Undo/redo of the app's own git actions, per repository and per session (not kept across restarts).
 * Every entry checks that the repository is still as the action left it; if something else changed it
 * (a terminal, another client), undo refuses and the history is cleared rather than guessing.
 */
export class UndoService {
  private readonly stacks = new Map<string, { undo: UndoEntry[]; redo: UndoEntry[] }>();

  constructor(
    private readonly deps: {
      git: GitCli;
      branches: BranchService;
      staging: StagingService;
      stashes: StashService;
      queue: RepoQueue;
      /** Folder for file copies made before a discard. */
      saveDir: string;
      /** Called when the labels change (for the toolbar). */
      changed(root: string, labels: { undo: string | null; redo: string | null }): void;
    },
  ) {}

  labels(root: string): { undo: string | null; redo: string | null } {
    const stack = this.stacks.get(root);
    return { undo: stack?.undo.at(-1)?.label ?? null, redo: stack?.redo.at(-1)?.label ?? null };
  }

  record(root: string, entry: UndoEntry): void {
    const stack = this.stack(root);
    stack.undo.push(entry);
    if (stack.undo.length > MAX_ENTRIES) stack.undo.shift();
    stack.redo = [];
    this.deps.changed(root, this.labels(root));
  }

  /** An action that cannot be undone (push, a conflicted merge…) ends the history: older entries would lie. */
  forget(root: string): void {
    this.stacks.delete(root);
    this.deps.changed(root, this.labels(root));
  }

  async undo(root: string): Promise<string> {
    const stack = this.stack(root);
    const entry = stack.undo.at(-1);
    if (!entry) throw new UndoError(t('Nothing to undo'));
    await this.check(root, entry.after);
    await this.execute(root, entry.undo);
    stack.undo.pop();
    if (entry.redo) stack.redo.push(entry);
    else stack.redo = [];
    this.deps.changed(root, this.labels(root));
    return entry.label;
  }

  async redo(root: string): Promise<string> {
    const stack = this.stack(root);
    const entry = stack.redo.at(-1);
    if (!entry?.redo) throw new UndoError(t('Nothing to redo'));
    await this.check(root, entry.before);
    await this.execute(root, entry.redo);
    stack.redo.pop();
    stack.undo.push(entry);
    this.deps.changed(root, this.labels(root));
    return entry.label;
  }

  async position(root: string): Promise<RepoPosition> {
    const head = await this.rev(root, 'HEAD');
    const { stdout } = await this.deps.git.exec(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root, readOnly: true, allowedExitCodes: [1] });
    return { head, branch: stdout.trim() || null };
  }

  async rev(root: string, ref: string): Promise<string | null> {
    const { exitCode, stdout } = await this.deps.git.exec(['rev-parse', '-q', '--verify', ref], { cwd: root, readOnly: true, allowedExitCodes: [1] });
    return exitCode === 0 ? stdout.trim() : null;
  }

  /** The index as a tree (null with unmerged entries). */
  async indexTree(root: string): Promise<string | null> {
    const { exitCode, stdout } = await this.deps.git.exec(['write-tree'], { cwd: root, allowedExitCodes: [128] });
    return exitCode === 0 ? stdout.trim() : null;
  }

  /** Uncommitted tracked changes as a stash commit, without touching anything (null when clean). */
  async workSnapshot(root: string): Promise<string | null> {
    const { stdout } = await this.deps.git.exec(['stash', 'create'], { cwd: root });
    return stdout.trim() || null;
  }

  /** Copies the given working tree files aside (null when they are too big to keep). */
  async saveFiles(root: string, paths: readonly string[]): Promise<string | null> {
    let total = 0;
    for (const path of paths) total += (await stat(join(root, path)).catch(() => null))?.size ?? 0;
    if (total > MAX_SAVED_BYTES) return null;
    await mkdir(this.deps.saveDir, { recursive: true });
    const dir = await mkdtemp(join(this.deps.saveDir, 'discard-'));
    for (const path of paths) {
      const target = join(dir, path);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(root, path), target, { recursive: true, verbatimSymlinks: true }).catch(() => {});
    }
    return dir;
  }

  private async check(root: string, expected: Expectation): Promise<void> {
    const position = await this.position(root);
    let ok = (expected.head === undefined || expected.head === position.head) && (expected.branch === undefined || expected.branch === position.branch);
    for (const [ref, sha] of Object.entries(expected.refs ?? {})) ok &&= (await this.rev(root, ref)) === sha;
    if (!ok) {
      this.forget(root);
      throw new UndoError(t('The repository changed since then (outside this undo history), so it cannot be undone safely. The undo history was cleared.'));
    }
  }

  private async execute(root: string, steps: readonly UndoStep[]): Promise<void> {
    const { git, branches, staging, stashes, queue } = this.deps;
    for (const step of steps) {
      switch (step.kind) {
        case 'git':
          await queue.run(root, () => git.exec(step.args, { cwd: root }));
          break;
        case 'checkout': {
          const result = await branches.checkout(root, step.target);
          if (result.message && result.stash !== 'restored') throw new UndoError(result.message);
          break;
        }
        case 'stashDrop':
          await stashes.drop(root, step.sha);
          break;
        case 'restoreFiles':
          for (const path of step.paths) {
            const source = join(step.from, path);
            if (!(await stat(source).catch(() => null))) continue;
            await rm(join(root, path), { recursive: true, force: true });
            await mkdir(dirname(join(root, path)), { recursive: true });
            await cp(source, join(root, path), { recursive: true, verbatimSymlinks: true });
          }
          break;
        case 'discard':
          await staging.discardFiles(root, step.tracked, step.untracked);
          break;
        case 'stashApply': {
          const { outcome, detail } = await stashes.apply(root, step.sha, step.drop);
          if (outcome !== 'applied') throw new UndoError(t('The stashed changes could not be restored cleanly ({detail})', { detail: detail ?? outcome }));
          break;
        }
      }
    }
  }

  private stack(root: string) {
    let stack = this.stacks.get(root);
    if (!stack) this.stacks.set(root, (stack = { undo: [], redo: [] }));
    return stack;
  }
}
