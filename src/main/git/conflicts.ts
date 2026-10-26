import { writeFile } from 'node:fs/promises';
import { Repository } from '@axosoft/nodegit';
import type { ConflictFile, ConflictSide, OperationAction } from '../../shared/conflicts';
import { t } from '../../shared/i18n';
import type { RepoOperation } from '../../shared/state';
import { resolveInsideRepo } from '../repoPaths';
import { GitCliError, type GitCli } from './cli';
import { fromIndex, fromWorkingTree } from './diff';
import { RepoQueue } from './repoQueue';

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

const ACTIONS: Record<RepoOperation['kind'], Partial<Record<OperationAction, string[]>>> = {
  // A merge is finished by committing; GIT_EDITOR=: keeps the prepared MERGE_MSG.
  merge: { continue: ['commit', '--no-edit'], abort: ['merge', '--abort'] },
  rebase: { continue: ['rebase', '--continue'], abort: ['rebase', '--abort'], skip: ['rebase', '--skip'] },
  'cherry-pick': { continue: ['cherry-pick', '--continue'], abort: ['cherry-pick', '--abort'], skip: ['cherry-pick', '--skip'] },
  revert: { continue: ['revert', '--continue'], abort: ['revert', '--abort'], skip: ['revert', '--skip'] },
};

/** Resolving conflicted files and continuing or aborting the operation that produced them. */
export class ConflictService {
  constructor(
    private readonly git: GitCli,
    private readonly queue = new RepoQueue(),
  ) {}

  async read(root: string, path: string): Promise<ConflictFile> {
    const repo = await Repository.open(root);
    const [base, ours, theirs, merged] = await Promise.all([
      fromIndex(repo, path, 1),
      fromIndex(repo, path, 2),
      fromIndex(repo, path, 3),
      fromWorkingTree(root, path),
    ]);
    if (!ours.exists && !theirs.exists && !base.exists) throw new ConflictError(t('{path} is not in conflict', { path }));
    return { path, base, ours, theirs, merged };
  }

  /**
   * Writes the resolved text; `expectedHash` is the working tree file as the editor loaded it, so a file
   * changed meanwhile (by an editor or a merge tool) is not overwritten. With `markResolved`, stages it.
   */
  save(root: string, path: string, text: string, expectedHash: string | null, markResolved: boolean): Promise<void> {
    return this.queue.run(root, async () => {
      const current = await fromWorkingTree(root, path);
      if (current.hash !== expectedHash) throw new ConflictError(t('{path} changed on disk since it was opened; reopen it to see the changes', { path }));
      await writeFile(await resolveInsideRepo(root, path), text, 'utf8');
      if (markResolved) await this.exec(root, ['add', '--', path]);
    });
  }

  /** Takes one side's whole file (a side that deleted the file deletes it) and marks it resolved. */
  take(root: string, path: string, side: ConflictSide): Promise<void> {
    return this.queue.run(root, async () => {
      const repo = await Repository.open(root);
      const version = await fromIndex(repo, path, side === 'ours' ? 2 : 3);
      if (version.exists) {
        await this.exec(root, ['checkout', `--${side}`, '--', path]);
        await this.exec(root, ['add', '--', path]);
      } else {
        await this.exec(root, ['rm', '-q', '--', path]);
      }
    });
  }

  /** Continue (all conflicts resolved), abort (back to before the operation) or skip the current commit. */
  operation(root: string, operation: RepoOperation, action: OperationAction): Promise<void> {
    return this.queue.run(root, async () => {
      const args = ACTIONS[operation.kind][action];
      if (!args) {
        const operationName = t(`operation|${operation.kind}`);
        const actionName = action === 'skip' ? t('operation|skipped') : action === 'abort' ? t('operation|aborted') : t('operation|continued');
        throw new ConflictError(t('A {operation} cannot be {action}', { operation: operationName, action: actionName }));
      }
      const before = await this.position(root);
      try {
        await this.exec(root, args, true);
      } catch (error) {
        // Continuing or skipping can stop again at the next commit's conflicts: that is progress, not a failure.
        // (Refusing to continue because conflicts remain moves nothing.)
        if (action === 'abort' || operation.kind === 'merge') throw error;
        const { stdout } = await this.git.exec(['diff', '--name-only', '--diff-filter=U'], { cwd: root, readOnly: true });
        if (!stdout.trim() || (await this.position(root)) === before) throw error;
      }
    });
  }

  /** HEAD and the commit being applied: changes whenever a sequencer step happened. */
  private async position(root: string): Promise<string> {
    const refs = await Promise.all(
      ['HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].map(async (ref) => {
        const { stdout } = await this.git.exec(['rev-parse', '-q', '--verify', ref], { cwd: root, readOnly: true, allowedExitCodes: [1] });
        return stdout.trim();
      }),
    );
    return refs.join(' ');
  }

  private async exec(root: string, args: string[], showOutput = false): Promise<void> {
    try {
      await this.git.exec(args, { cwd: root });
    } catch (error) {
      if (!(error instanceof GitCliError)) throw error;
      // Hooks and rebase steps explain themselves in their output.
      const output = `${error.stdout}\n${error.stderr}`.split('\n').filter((line) => line.trim() && !/^hint:/.test(line)).slice(-30).join('\n');
      throw new ConflictError(showOutput && output ? `${error.message.replace(/^git .*? failed: (error: |fatal: )?/, '')}\n${output}` : error.message.replace(/^git .*? failed: (error: |fatal: )?/, ''));
    }
  }
}

