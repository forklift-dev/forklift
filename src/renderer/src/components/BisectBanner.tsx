import { useState } from 'react';
import type { BisectStatus } from '../../../shared/bisect';
import { t } from '../../../shared/i18n';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { useAppState } from '../state';
import { useConfirm } from './ConfirmDialog';
import { useFormDialog } from './FormDialog';

export function BisectBanner({ repo, status, head, run, runInBackground }: { repo: string; status: BisectStatus; head: string | null; run: RunAction; runInBackground: RunAction }) {
  const [showLog, setShowLog] = useState(false);
  const [showOutput, setShowOutput] = useState(true);
  const activity = useAppState((state) => state.repo.path === repo ? state.repo.bisect : null);
  const { confirm, dialog } = useConfirm();
  const { form, dialog: formDialog } = useFormDialog();
  const mark = (kind: 'good' | 'bad' | 'skip') => head && void run(() => invoke('bisect:mark', repo, kind, head));
  const runScript = () => void form({
    title: t('Run bisect script'),
    detail: t('The program runs at each checked-out commit. Exit 0 means good, 1 means bad, and 125 skips a commit.'),
    fields: [
      { name: 'program', label: t('Program'), placeholder: 'npm' },
      { name: 'args', label: t('Arguments (one per line)'), type: 'textarea', placeholder: 'test\n--\nmy-test' },
    ],
    confirmLabel: t('Run bisect'),
    validate: async (values) => String(values['program'] ?? '').trim() ? null : t('Enter a program'),
    submit: async (values) => {
      const program = String(values['program'] ?? '').trim();
      const args = String(values['args'] ?? '').split(/\r?\n/).filter((line) => line.length > 0);
      setShowOutput(true);
      void runInBackground(() => invoke('bisect:run', repo, program, args));
      return null;
    },
  });
  const reset = async () => {
    if (await confirm({ title: t('End bisect?'), detail: t('Git will restore the branch and checkout from before bisect.'), confirmLabel: t('End bisect') })) {
      await run(() => invoke('bisect:reset', repo));
    }
  };
  const pending = !status.bad || !status.good.length;
  const disabled = Boolean(activity?.running || status.found);
  return (
    <div className="bisect-panel" role="status">
      <div className="operation-banner bisect-banner">
        <span className="codicon codicon-search" aria-hidden="true" />
        <span className="operation-text">
          {status.found
            ? t('First bad commit: {sha}', { sha: status.found.slice(0, 7) })
            : pending
              ? t('Bisect: mark a good and a bad commit to define the range')
              : t('Bisect: step {step}, {count} candidates, about {remaining} checks left', { step: Math.max(1, status.tested - 1), count: status.remaining ?? 0, remaining: status.steps ?? 0 })}
        </span>
        {head && !status.found && <>
          <button type="button" disabled={disabled} onClick={() => mark('good')}>{t('Good')}</button>
          <button type="button" disabled={disabled} onClick={() => mark('bad')}>{t('Bad')}</button>
          <button type="button" disabled={disabled || pending} onClick={() => mark('skip')}>{t('Skip')}</button>
        </>}
        {!pending && !status.found && !activity?.running && <button type="button" onClick={runScript}>{t('Run script…')}</button>}
        {activity?.running && <button type="button" onClick={() => void invoke('bisect:cancel', repo)}>{t('Stop')}</button>}
        <button type="button" onClick={() => setShowLog((value) => !value)}>{t('Bisect log')}</button>
        <button type="button" className="danger-text" disabled={activity?.running} onClick={() => void reset()}>{t('End bisect')}</button>
      </div>
      {showLog && <pre className="bisect-output">{status.log}</pre>}
      {activity?.output.length ? <>
        <div className="bisect-output-actions">
          <button type="button" onClick={() => setShowOutput((value) => !value)}>{t('Script output')}</button>
          {!activity.running && <button type="button" onClick={() => void invoke('bisect:clearOutput', repo)}>{t('Dismiss')}</button>}
        </div>
        {showOutput && <pre className="bisect-output">{activity.output.join('\n')}</pre>}
      </> : null}
      {dialog}{formDialog}
    </div>
  );
}
