import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../../../shared/i18n';

export interface ConfirmOptions {
  title: string;
  detail?: string;
  confirmLabel: string;
  /** Destructive actions get a warning-colored confirm button. */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve(confirmed: boolean): void;
}

/** `confirm()` resolves true only when the user explicitly confirms; Escape and Cancel resolve false. */
export function useConfirm(): { confirm(options: ConfirmOptions): Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const close = (confirmed: boolean) => {
    pending?.resolve(confirmed);
    setPending(null);
  };

  return { confirm, dialog: pending && <ConfirmDialog options={pending} onClose={close} /> };
}

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose(confirmed: boolean): void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Safe default: focus lands on Cancel, so a stray Enter does not destroy work.
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => onClose(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="confirm-title">{options.title}</h2>
        {options.detail && <p>{options.detail}</p>}
        <div className="modal-actions">
          <button type="button" ref={cancelRef} onClick={() => onClose(false)}>
            {t('Cancel')}
          </button>
          <button type="button" className={options.danger ? 'danger' : 'primary'} onClick={() => onClose(true)}>
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
