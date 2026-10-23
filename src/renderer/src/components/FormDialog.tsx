import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'checkbox';
  initial?: string | boolean;
  placeholder?: string;
}

export type FormValues = Record<string, string | boolean>;

export interface FormOptions {
  title: string;
  detail?: string;
  fields: FormField[];
  confirmLabel: string;
  /** Live check while typing (debounced); a message disables the confirm button. */
  validate?(values: FormValues): Promise<string | null>;
  /** Runs the action; an error message keeps the dialog open and shows it. */
  submit(values: FormValues): Promise<string | null>;
}

interface Pending extends FormOptions {
  resolve(done: boolean): void;
}

/** `form(options)` resolves true once `submit` succeeded, false when cancelled. */
export function useFormDialog(): { form(options: FormOptions): Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const form = useCallback((options: FormOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })), []);
  const close = (done: boolean) => {
    pending?.resolve(done);
    setPending(null);
  };
  return { form, dialog: pending && <FormDialog options={pending} onClose={close} /> };
}

function FormDialog({ options, onClose }: { options: FormOptions; onClose(done: boolean): void }) {
  const id = useId();
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(options.fields.map((field) => [field.name, field.initial ?? (field.type === 'checkbox' ? false : '')])),
  );
  const [problem, setProblem] = useState<string | null>(null);
  // A check failing on the untouched form (an empty name) disables the button but is not shown yet.
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
    if (firstRef.current instanceof HTMLInputElement) firstRef.current.select();
  }, []);

  useEffect(() => {
    if (!options.validate) return;
    let current = true;
    const timer = setTimeout(() => {
      void options.validate!(values).then((message) => current && setProblem(message));
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [values, options]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const submit = async () => {
    if (busy || problem) return;
    setBusy(true);
    setError(null);
    const failure = await options.submit(values);
    setBusy(false);
    if (failure) setError(failure);
    else onClose(true);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => onClose(false)}>
      <form
        className="modal form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onMouseDown={(event) => event.stopPropagation()}
        onChange={() => setTouched(true)}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 id={`${id}-title`}>{options.title}</h2>
        {options.detail && <p>{options.detail}</p>}
        {options.fields.map((field, index) => {
          const ref = index === 0 ? (element: HTMLInputElement | HTMLTextAreaElement | null) => void (firstRef.current = element) : undefined;
          if (field.type === 'checkbox') {
            return (
              <label key={field.name} className="checkbox-label">
                <input
                  ref={ref}
                  type="checkbox"
                  name={field.name}
                  checked={values[field.name] as boolean}
                  onChange={(event) => setValues((v) => ({ ...v, [field.name]: event.target.checked }))}
                />
                {field.label}
              </label>
            );
          }
          const common = {
            id: `${id}-${field.name}`,
            name: field.name,
            value: values[field.name] as string,
            placeholder: field.placeholder,
            spellCheck: false,
          };
          return (
            <label key={field.name} className="form-field">
              {field.label}
              {field.type === 'textarea' ? (
                <textarea ref={ref} rows={4} {...common} onChange={(event) => setValues((v) => ({ ...v, [field.name]: event.target.value }))} />
              ) : (
                <input ref={ref} type="text" {...common} onChange={(event) => setValues((v) => ({ ...v, [field.name]: event.target.value }))} />
              )}
            </label>
          );
        })}
        {(error ?? (touched ? problem : null)) && (
          <p className="setting-error" role="alert">
            {error ?? problem}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || Boolean(problem)}>
            {options.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
