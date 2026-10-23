import type { CheckoutTarget } from '../../shared/branches';
import type { ResetMode } from './commitOps';
import type { RepoPosition, UndoService, UndoStep } from './undo';

const short = (sha: string) => sha.slice(0, 7);
const backTo = (position: RepoPosition): CheckoutTarget =>
  position.branch ? { kind: 'branch', name: position.branch } : { kind: 'commit', sha: position.head! };

/**
 * Wraps the app's git actions and records how to undo and redo each one. A failed action records
 * nothing; an action that leaves an operation in progress (conflicts) ends the history.
 */
export class UndoRecorder {
  constructor(private readonly undo: UndoService) {}

  /** Commit or amend: undo moves the branch back keeping the changes staged. */
  async commit<T>(root: string, label: string, action: () => Promise<T>): Promise<T> {
    return this.move(root, label, 'soft', action);
  }

  /**
   * cherry-pick, revert, merge, rebase, pull: when it finished ('done'), undo moves the branch back with
   * `reset --keep` (uncommitted changes survive or the undo is refused); 'conflicts' ends the history.
   */
  async history<T extends string | void>(root: string, label: string, action: () => Promise<T>): Promise<T> {
    const before = await this.undo.position(root);
    const result = await action();
    if (result === 'conflicts') {
      this.undo.forget(root);
      return result;
    }
    await this.recordMove(root, label, 'keep', before);
    return result;
  }

  async checkout<T>(root: string, target: CheckoutTarget, action: () => Promise<T>): Promise<T> {
    const before = await this.undo.position(root);
    const createdBefore = target.kind === 'remote' ? await this.undo.rev(root, `refs/heads/${target.name.slice(target.remote.length + 1)}`) : null;
    const result = await action();
    const after = await this.undo.position(root);
    if (!before.head || (after.head === before.head && after.branch === before.branch)) return result;
    const undo: UndoStep[] = [{ kind: 'checkout', target: backTo(before) }];
    // Checking out a remote branch created a local one: undo removes it again.
    if (target.kind === 'remote' && createdBefore === null && after.branch) undo.push({ kind: 'git', args: ['branch', '-D', after.branch] });
    const what = target.kind === 'commit' ? short(target.sha) : target.name;
    this.undo.record(root, {
      label: `checkout of ${what}`,
      undo,
      redo: [{ kind: 'checkout', target }],
      after: { head: after.head, branch: after.branch },
      before: { head: before.head, branch: before.branch },
    });
    return result;
  }

  async createBranch<T>(root: string, name: string, sha: string, checkout: boolean, action: () => Promise<T>): Promise<T> {
    const before = await this.undo.position(root);
    const result = await action();
    const ref = `refs/heads/${name}`;
    this.undo.record(root, {
      label: `branch ${name}`,
      undo: [...(checkout && before.head ? [{ kind: 'checkout' as const, target: backTo(before) }] : []), { kind: 'git', args: ['branch', '-D', name] }],
      redo: [{ kind: 'git', args: ['branch', name, sha] }, ...(checkout ? [{ kind: 'checkout' as const, target: { kind: 'branch' as const, name } }] : [])],
      after: { refs: { [ref]: sha }, ...(checkout && { branch: name }) },
      before: { refs: { [ref]: null }, ...(checkout && { branch: before.branch, head: before.head }) },
    });
    return result;
  }

  async renameBranch<T>(root: string, from: string, to: string, action: () => Promise<T>): Promise<T> {
    const sha = await this.undo.rev(root, `refs/heads/${from}`);
    const result = await action();
    this.undo.record(root, {
      label: `rename of ${from} to ${to}`,
      undo: [{ kind: 'git', args: ['branch', '-m', to, from] }],
      redo: [{ kind: 'git', args: ['branch', '-m', from, to] }],
      after: { refs: { [`refs/heads/${to}`]: sha, [`refs/heads/${from}`]: null } },
      before: { refs: { [`refs/heads/${from}`]: sha, [`refs/heads/${to}`]: null } },
    });
    return result;
  }

  async deleteBranch<T>(root: string, name: string, action: () => Promise<T>): Promise<T> {
    const sha = await this.undo.rev(root, `refs/heads/${name}`);
    const result = await action();
    if (sha) {
      this.undo.record(root, {
        label: `deletion of branch ${name}`,
        undo: [{ kind: 'git', args: ['branch', name, sha] }],
        redo: [{ kind: 'git', args: ['branch', '-D', name] }],
        after: { refs: { [`refs/heads/${name}`]: null } },
        before: { refs: { [`refs/heads/${name}`]: sha } },
      });
    }
    return result;
  }

  /** Tags are restored with update-ref to the same object, so an annotated tag comes back as it was. */
  async tag<T>(root: string, name: string, created: boolean, action: () => Promise<T>): Promise<T> {
    const ref = `refs/tags/${name}`;
    const before = await this.undo.rev(root, ref);
    const result = await action();
    const after = await this.undo.rev(root, ref);
    const object = created ? after : before;
    if (!object) return result;
    const remove: UndoStep = { kind: 'git', args: ['tag', '-d', name] };
    const restore: UndoStep = { kind: 'git', args: ['update-ref', ref, object] };
    this.undo.record(root, {
      label: created ? `tag ${name}` : `deletion of tag ${name}`,
      undo: [created ? remove : restore],
      redo: [created ? restore : remove],
      after: { refs: { [ref]: after } },
      before: { refs: { [ref]: before } },
    });
    return result;
  }

  /** Reset: the index (mixed) and the uncommitted changes (hard) are snapshotted first, so undo brings them back. */
  async reset<T>(root: string, mode: ResetMode, action: () => Promise<T>): Promise<T> {
    const before = await this.undo.position(root);
    const index = mode === 'soft' ? null : await this.undo.indexTree(root);
    const work = mode === 'hard' ? await this.undo.workSnapshot(root) : null;
    const result = await action();
    const after = await this.undo.position(root);
    if (!before.head || !after.head) return result;
    const undo: UndoStep[] = [{ kind: 'git', args: ['reset', '-q', mode === 'hard' ? '--hard' : '--soft', before.head] }];
    if (mode === 'mixed' && index) undo.push({ kind: 'git', args: ['read-tree', index] });
    if (mode === 'hard' && work) undo.push({ kind: 'git', args: ['stash', 'apply', '--index', work] });
    this.undo.record(root, {
      label: `${mode} reset to ${short(after.head)}`,
      undo,
      redo: [{ kind: 'git', args: ['reset', '-q', `--${mode}`, after.head] }],
      after: { head: after.head, branch: after.branch },
      before: { head: before.head, branch: before.branch },
    });
    return result;
  }

  /** Discarded files are copied aside first (up to 50 MB; beyond that the discard cannot be undone). */
  async discard<T>(root: string, tracked: string[], untracked: string[], action: () => Promise<T>): Promise<T> {
    const position = await this.undo.position(root);
    const saved = await this.undo.saveFiles(root, [...tracked, ...untracked]);
    const result = await action();
    if (!saved) {
      this.undo.forget(root);
      return result;
    }
    const count = tracked.length + untracked.length;
    this.undo.record(root, {
      label: count === 1 ? `discard of ${[...tracked, ...untracked][0]}` : `discard of ${count} files`,
      undo: [{ kind: 'restoreFiles', from: saved, paths: [...tracked, ...untracked] }],
      redo: [{ kind: 'discard', tracked, untracked }],
      after: { head: position.head },
      before: { head: position.head },
    });
    return result;
  }

  /** A stash push is undone by popping it; it cannot be redone as the same stash. */
  async stashPush(root: string, action: () => Promise<string | null>): Promise<string | null> {
    const sha = await action();
    if (sha) {
      this.undo.record(root, {
        label: 'stash',
        undo: [{ kind: 'stashApply', sha, drop: true }],
        redo: null,
        after: { refs: { 'refs/stash': sha } },
        before: {},
      });
    }
    return sha;
  }

  /** A dropped stash is stored again from its commit. */
  async stashDrop<T>(root: string, sha: string, message: string, action: () => Promise<T>): Promise<T> {
    const result = await action();
    this.undo.record(root, {
      label: 'deletion of a stash',
      undo: [{ kind: 'git', args: ['stash', 'store', '-m', message, sha] }],
      redo: [{ kind: 'stashDrop', sha }],
      after: {},
      before: {},
    });
    return result;
  }

  private async move<T>(root: string, label: string, mode: 'soft' | 'keep', action: () => Promise<T>): Promise<T> {
    const before = await this.undo.position(root);
    const result = await action();
    await this.recordMove(root, label, mode, before);
    return result;
  }

  private async recordMove(root: string, label: string, mode: 'soft' | 'keep', before: RepoPosition): Promise<void> {
    const after = await this.undo.position(root);
    if (!before.head || !after.head || before.head === after.head) return;
    this.undo.record(root, {
      label,
      undo: [{ kind: 'git', args: ['reset', '-q', `--${mode}`, before.head] }],
      redo: [{ kind: 'git', args: ['reset', '-q', `--${mode}`, after.head] }],
      after: { head: after.head, branch: after.branch },
      before: { head: before.head, branch: before.branch },
    });
  }
}
