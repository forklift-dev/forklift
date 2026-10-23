import type { RepoData } from '../../../shared/state';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { useConfirm } from './ConfirmDialog';

const VERB = { merge: 'Merging', rebase: 'Rebasing', 'cherry-pick': 'Cherry-picking', revert: 'Reverting' } as const;

/** Shown while a merge, rebase, cherry-pick or revert waits for the user: progress, conflicts, continue/skip/abort. */
export function OperationBanner({ repo, data, run }: { repo: string; data: RepoData; run: RunAction }) {
  const { confirm, dialog } = useConfirm();
  const operation = data.operation;
  if (!operation) return null;
  const conflicted = data.changes.filter((change) => change.kind === 'conflicted').length;
  const progress = operation.step && operation.total ? ` (commit ${operation.step} of ${operation.total})` : '';

  const abort = async () => {
    const ok = await confirm({
      title: `Abort the ${operation.kind}?`,
      detail: `The repository goes back to how it was before the ${operation.kind}; resolutions made so far are lost.`,
      confirmLabel: 'Abort',
      danger: true,
    });
    if (ok) await run(() => invoke('operation:run', repo, 'abort'));
  };

  return (
    <div className="operation-banner" role="status">
      <span className="codicon codicon-git-merge" aria-hidden="true" />
      <span className="operation-text">
        {VERB[operation.kind]}
        {operation.subject && <strong> {operation.subject}</strong>}
        {progress}
        {conflicted > 0 ? ` — ${conflicted} conflicted file${conflicted === 1 ? '' : 's'} to resolve` : ' — all conflicts resolved'}
      </span>
      <button
        type="button"
        className="primary"
        disabled={conflicted > 0}
        title={conflicted > 0 ? 'Resolve all conflicts first' : operation.kind === 'merge' ? 'Commit the merge' : `Continue the ${operation.kind}`}
        onClick={() => void run(() => invoke('operation:run', repo, 'continue'))}
      >
        {operation.kind === 'merge' ? 'Commit merge' : 'Continue'}
      </button>
      {operation.kind !== 'merge' && (
        <button type="button" onClick={() => void run(() => invoke('operation:run', repo, 'skip'))} title="Leave this commit out">
          Skip
        </button>
      )}
      <button type="button" className="danger-text" onClick={() => void abort()}>
        Abort
      </button>
      {dialog}
    </div>
  );
}
