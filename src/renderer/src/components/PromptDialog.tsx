import { useEffect, useRef, useState } from 'react';
import type { AskPrompt } from '../../../shared/state';
import { invoke } from '../api';

const TITLES: Record<AskPrompt['kind'], string> = {
  username: 'Sign in',
  password: 'Sign in',
  passphrase: 'Unlock SSH key',
  confirm: 'Unknown SSH host',
  other: 'git asks',
};

/**
 * A question from git or ssh during a fetch, pull or push (credentials, a key passphrase, a new host key).
 * The answer goes straight to the waiting git process; it is not kept anywhere in the app.
 */
export function PromptDialog({ prompt, repoName }: { prompt: AskPrompt; repoName: string | null }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const secret = prompt.kind === 'password' || prompt.kind === 'passphrase';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const answer = (text: string | null) => void invoke('askpass:answer', prompt.id, text);

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
          {TITLES[prompt.kind]}
          {repoName && <span className="prompt-repo"> — {repoName}</span>}
        </h2>
        <p className="prompt-text">{prompt.prompt.trim()}</p>
        {prompt.kind === 'confirm' ? (
          <div className="modal-actions">
            <button type="button" onClick={() => answer('no')}>
              No
            </button>
            <button type="button" className="primary" onClick={() => answer('yes')}>
              Trust this host
            </button>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              type={secret ? 'password' : 'text'}
              aria-label={prompt.kind === 'username' ? 'Username' : 'Answer'}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {secret && <p className="prompt-note">Saved only if your git credential helper stores it.</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => answer(null)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Continue
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
