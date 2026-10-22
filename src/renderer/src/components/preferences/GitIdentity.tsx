import { useState } from 'react';
import type { ConfigScope } from '../../../../shared/ipc';
import type { GitIdentity } from '../../../../shared/settings';
import { invoke } from '../../api';
import { useCommand } from '../../useCommand';
import { errorText } from './SettingRow';

/** user.name / user.email from git config: global, or the open repository's own. */
export function GitIdentityEditor({ scope }: { scope: ConfigScope }) {
  const { data, error } = useCommand('git:identity', [scope]);
  return (
    <div className="setting-row" data-setting="git.identity">
      <div className="setting-text">
        <label htmlFor={`identity-${scope}-name`}>Commit author</label>
        <p>
          {scope === 'global'
            ? 'user.name and user.email in your global git config (~/.gitconfig): git uses them everywhere, not only in Forklift.'
            : "user.name and user.email in this repository's .git/config. Leave empty to use the global identity."}
        </p>
      </div>
      <div className="setting-control">
        {error && <p className="setting-error">{error}</p>}
        {data && <IdentityForm scope={scope} initial={data} />}
      </div>
    </div>
  );
}

function IdentityForm({ scope, initial }: { scope: ConfigScope; initial: GitIdentity }) {
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const changed = name !== saved.name || email !== saved.email;

  const save = async () => {
    try {
      await invoke('git:setIdentity', scope, { name, email });
      const trimmed = { name: name.trim(), email: email.trim() };
      setSaved(trimmed);
      setName(trimmed.name);
      setEmail(trimmed.email);
      setStatus({ text: 'Saved', ok: true });
    } catch (error) {
      setStatus({ text: errorText(error), ok: false });
    }
  };

  return (
    <form
      className="identity-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input id={`identity-${scope}-name`} aria-label="Name" placeholder="Name" value={name} maxLength={256} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Email" placeholder="Email" type="email" value={email} maxLength={256} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit" disabled={!changed}>
        Save
      </button>
      {status && <p className={status.ok ? 'tool-status' : 'setting-error'}>{status.text}</p>}
    </form>
  );
}
