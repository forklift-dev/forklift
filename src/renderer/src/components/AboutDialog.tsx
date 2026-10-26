import { useEffect, useId, useRef } from 'react';
import { t } from '../../../shared/i18n';
import logo from '../../../../build/window.png';

interface AboutDialogProps {
  version: string;
  onClose(): void;
}

/** Community-edition credits and the promise that defines this edition. */
export function AboutDialog({ version, onClose }: AboutDialogProps) {
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

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
