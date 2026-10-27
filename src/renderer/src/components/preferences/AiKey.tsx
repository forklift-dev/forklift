import { useEffect, useState } from 'react';
import { t } from '../../../../shared/i18n';
import { invoke } from '../../api';

/** The key never joins the replicated settings state and is never shown again after saving. */
export function AiKeyEditor() {
  const [status, setStatus] = useState<{ available: boolean; saved: boolean } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void invoke('ai:keyStatus').then((value) => { if (active) setStatus(value); }, (cause: unknown) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await invoke('ai:keySet', key);
      setKey('');
      setStatus({ available: true, saved: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await invoke('ai:keyRemove');
      setStatus((previous) => ({ available: previous?.available ?? false, saved: false }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };

  return <div className="setting-row ai-key-editor">
    <div><strong>{t('OpenAI API key')}</strong><p>{t('Encrypted with the system keychain. Used only after confirming a request; OpenAI may charge for tokens.')}</p></div>
    {!status?.available ? <p className="setting-error">{t('System keychain unavailable: API key cannot be saved')}</p> : <>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder={status.saved ? t('Key saved') : t('Paste API key')} aria-label={t('OpenAI API key')} />
        <button type="submit" disabled={busy || key.trim().length < 10}>{t('Save key')}</button>
        {status.saved && <button type="button" disabled={busy} onClick={() => void remove()}>{t('Remove key')}</button>}
      </form>
    </>}
    {error && <p className="setting-error" role="alert">{error}</p>}
  </div>;
}
