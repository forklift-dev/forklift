import type { RepoData } from '../../../shared/state';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { useConfirm } from './ConfirmDialog';
import { t } from '../../../shared/i18n';

const verb = (kind: NonNullable<RepoData['operation']>['kind']) => ({ merge: t('Merging'), rebase: t('Rebasing'), 'cherry-pick': t('Cherry-picking'), revert: t('Reverting') })[kind];

/** Shown while a merge, rebase, cherry-pick or revert waits for the user: progress, conflicts, continue/skip/abort. */
export function OperationBanner({ repo, data, run }: { repo: string; data: RepoData; run: RunAction }) {
  const { confirm, dialog } = useConfirm();
  const operation = data.operation;
  if (!operation) return null;
  const conflicted = data.changes.filter((change) => change.kind === 'conflicted').length;
  const progress = operation.step && operation.total ? t(' (commit {step} of {total})', { step: operation.step, total: operation.total }) : '';
  const subject = operation.subject ? ` ${operation.subject}` : '';

  const abort = async () => {
    const ok = await confirm({
      title: t('Abort the {operation}?', { operation: operation.kind }),
      detail: t('The repository goes back to how it was before the {operation}; resolutions made so far are lost.', { operation: operation.kind }),
      confirmLabel: t('Abort'),
      danger: true,
    });
    if (ok) await run(() => invoke('operation:run', repo, 'abort'));
  };

  return (
    <div className="operation-banner" role="status">
      <span className="codicon codicon-git-merge" aria-hidden="true" />
      <span className="operation-text">
        {conflicted > 0
          ? t('{verb}{subject}{progress} — {count} conflicted files to resolve', { verb: verb(operation.kind), subject, progress, count: conflicted })
          : t('{verb}{subject}{progress} — all conflicts resolved', { verb: verb(operation.kind), subject, progress })}
      </span>
      <button
        type="button"
        className="primary"
        disabled={conflicted > 0}
        title={conflicted > 0 ? t('Resolve all conflicts first') : operation.kind === 'merge' ? t('Commit the merge') : t('Continue the {operation}', { operation: operation.kind })}
        onClick={() => void run(() => invoke('operation:run', repo, 'continue'))}
      >
        {operation.kind === 'merge' ? t('Commit merge') : t('Continue')}
      </button>
      {operation.kind !== 'merge' && (
        <button type="button" onClick={() => void run(() => invoke('operation:run', repo, 'skip'))} title={t('Leave this commit out')}>
          {t('Skip')}
        </button>
      )}
      <button type="button" className="danger-text" onClick={() => void abort()}>
        {t('Abort')}
      </button>
      {dialog}
    </div>
  );
}
