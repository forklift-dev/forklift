import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../../../shared/i18n';
import type { ReleaseCheck } from '../../../shared/releases';
import { invoke } from '../api';
import logo from '../../../../build/window.png';

interface AboutDialogProps {
  version: string;
  onClose(): void;
}

/** Community-edition credits and the promise that defines this edition. */
export function AboutDialog({ version, onClose }: AboutDialogProps) {
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [check, setCheck] = useState<ReleaseCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const checkNow = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      setCheck(await invoke('app:checkRelease'));
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    closeRef.current?.focus();
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
      <section className="modal about-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="about-header">
          <img className="about-logo" src={logo} alt="" />
          <div>
            <h2 id={`${id}-title`}>{t('About Forklift')}</h2>
            <p>{t('Community edition · version {version}', { version })}</p>
          </div>
        </header>
        <h3>{t('Authors')}</h3>
        <p className="about-authors">
          <a href="https://t.me/akryll" target="_blank" rel="noreferrer">@akryll</a>
          <span aria-hidden="true"> · </span>
          <span>Claude (Anthropic)</span>
        </p>
        <p className="about-promise">{t('This edition will always be open and free, with no paid features.')}</p>
        <div className="about-update">
          <button type="button" disabled={checking} onClick={() => void checkNow()}>{checking ? t('Checking for updates…') : t('Check for updates')}</button>
          {check?.status === 'available' && <p>{t('A new Forklift release is available: {version}', { version: check.release.version })} <a href={check.release.url} target="_blank" rel="noreferrer">{t('View release')}</a></p>}
          {check?.status === 'current' && <p>{t('You have the latest version.')}</p>}
          {check?.status === 'unsupported' && <p>{t('No release is available for this platform.')}</p>}
          {checkError && <p role="alert">{t('Could not check for updates: {error}', { error: checkError })}</p>}
        </div>
        <blockquote>
          <p>{t('“A slave dreams not of freedom, but of owning slaves.”')}</p>
          <footer>{t('— attributed to Marcus Tullius (a modern aphorism with no established source)')}</footer>
        </blockquote>
        <div className="modal-actions">
          <button ref={closeRef} type="button" onClick={onClose}>{t('Close')}</button>
        </div>
      </section>
    </div>
  );
}
