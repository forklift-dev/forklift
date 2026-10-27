import { useEffect, useRef, useState } from 'react';
import { t, type Message } from '../../../shared/i18n';
import { invoke } from '../api';
import { useAppState } from '../state';
import { useConfirm } from './ConfirmDialog';

type Task = 'message' | 'review' | 'conflict' | 'commit';

const labels: Record<Task, Message> = {
  message: 'Suggest commit message',
  review: 'Review staged changes',
  conflict: 'Explain conflict',
  commit: 'Explain commit',
};

/** AI output is shown as a suggestion; it never commits or changes a conflict automatically. */
export function AiAssist({ repo, task, target, onUse }: { repo: string; task: Task; target?: string; onUse?(text: string): void }) {
  const enabled = useAppState((state) => state.settings.values['ai.provider'] === 'ollama');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  const { confirm, dialog } = useConfirm();
  useEffect(() => () => { if (requestId.current) void invoke('ai:cancel', requestId.current); }, []);

  if (!enabled) return null;

  const cancel = () => {
    if (requestId.current) void invoke('ai:cancel', requestId.current);
    requestId.current = null;
    setBusy(false);
  };
  const run = async () => {
    const ok = await confirm({
      title: t(labels[task]),
      detail: t('Allow local Ollama to process the selected repository content for this request? Local Ollama uses no paid API tokens. Other providers may charge for tokens and will ask separately.'),
      confirmLabel: t('Send to Ollama'),
    });
    if (!ok) return;
    const id = crypto.randomUUID();
    requestId.current = id;
    setBusy(true);
    setError('');
    setResult('');
    try {
      const answer = await invoke('ai:assist', repo, task, id, target);
      if (requestId.current === id) setResult(answer);
    } catch (cause) {
      if (requestId.current === id) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestId.current === id) { requestId.current = null; setBusy(false); }
    }
  };

  return <div className="ai-assist">
    <button type="button" onClick={() => void run()} disabled={busy}>{busy ? t('Asking Ollama…') : t(labels[task])}</button>
    {busy && <button type="button" onClick={cancel}>{t('Cancel')}</button>}
    {error && <p className="setting-error" role="alert">{error}</p>}
    {result && <div className="ai-result"><pre>{result}</pre>{onUse && <button type="button" onClick={() => onUse(result)}>{t('Use suggestion')}</button>}</div>}
    {dialog}
  </div>;
}
