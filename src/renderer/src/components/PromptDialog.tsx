import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n';
import type { AskPrompt } from '../../../shared/state';
import { invoke } from '../api';
import { useAppState } from '../state';

const title = (kind: AskPrompt['kind']) =>
  ({ username: t('Sign in'), password: t('Sign in'), passphrase: t('Unlock SSH key'), confirm: t('Unknown SSH host'), other: t('git asks') })[kind];

/**
 * A question from git or ssh during a fetch, pull or push (credentials, a key passphrase, a new host key).
 * The answer goes straight to the waiting git process; a password is kept (encrypted with the system keychain)
 * only when "Remember" is on and git reports that it worked.
 */
export function PromptDialog({ prompt, repoName }: { prompt: AskPrompt; repoName: string | null }) {
  const [value, setValue] = useState('');
  const canRemember = useAppState((s) => s.app.secretStorage) && prompt.kind === 'password';
  const [remember, setRemember] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const secret = prompt.kind === 'password' || prompt.kind === 'passphrase';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const answer = (text: string | null) => void invoke('askpass:answer', prompt.id, text, text !== null && canRemember && remember);

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal form-dialog prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-title"
        onSubmit={(event) => {
          event.preventDefault();
          answer(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            answer(null);
          }
        }}
      >
        <h2 id="prompt-title">
          {title(prompt.kind)}
          {repoName && <span className="prompt-repo"> — {repoName}</span>}
        </h2>
        <p className="prompt-text">{prompt.prompt.trim()}</p>
        {prompt.kind === 'confirm' ? (
          <div className="modal-actions">
            <button type="button" onClick={() => answer('no')}>
              {t('No')}
            </button>
            <button type="button" className="primary" onClick={() => answer('yes')}>
              {t('Trust this host')}
            </button>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              type={secret ? 'password' : 'text'}
              aria-label={prompt.kind === 'username' ? t('Username') : t('Answer')}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {canRemember && (
              <label className="checkbox-label prompt-remember">
                <input type="checkbox" name="remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                {t('Remember (in the system keychain, once git accepts it)')}
              </label>
            )}
            {secret && !canRemember && prompt.kind === 'password' && <p className="prompt-note">{t('Not saved: no system keychain is available. Your git credential helper may still save it.')}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => answer(null)}>
                {t('Cancel')}
              </button>
              <button type="submit" className="primary">
                {t('Continue')}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
