import { useEffect, useId, useState } from 'react';
import { t } from '../../../shared/i18n';
import type { LfsInfo } from '../../../shared/lfs';
import { invoke } from '../api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The repository's LFS patterns: untrack one, or track a new one (edits .gitattributes, to be committed). */
export function LfsDialog({ repo, info, onClose }: { repo: string; info: LfsInfo | undefined; onClose(): void }) {
  const id = useId();
  const [pattern, setPattern] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal form-dialog lfs-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void act(() => invoke('lfs:track', repo, pattern.trim())).then((ok) => ok && setPattern(''));
        }}
      >
        <h2 id={`${id}-title`}>Git LFS</h2>
        {info && !info.installed && (
          <p className="setting-error" role="alert">
            {t('git-lfs is not installed, so files cannot be tracked or downloaded. Install it from https://git-lfs.com, then run “git lfs install” once.')}
          </p>
        )}
        {info?.installed && <p>{t('git-lfs {version}. Patterns go into .gitattributes; commit it. Files already committed move to LFS once added again.', { version: info.installed })}</p>}
        <ul className="lfs-patterns">
          {info?.patterns.map((item) => (
            <li key={item}>
              <code>{item}</code>
              <button type="button" className="link-button" disabled={busy} onClick={() => void act(() => invoke('lfs:untrack', repo, item))}>
                {t('Untrack')}
              </button>
            </li>
          ))}
          {info && info.patterns.length === 0 && <li className="empty-note">{t('Nothing is tracked with LFS')}</li>}
        </ul>
        <label className="form-field">
          {t('Track files matching')}
          <input type="text" name="pattern" value={pattern} spellCheck={false} placeholder="*.psd" disabled={!info?.installed} onChange={(event) => setPattern(event.target.value)} />
        </label>
        {error && (
          <p className="setting-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t('Close')}
          </button>
          <button type="submit" className="primary" disabled={busy || !pattern.trim() || !info?.installed}>
            {t('Track')}
          </button>
        </div>
      </form>
    </div>
  );
}
