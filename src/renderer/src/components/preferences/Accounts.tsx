import { useRef, useState } from 'react';
import { PROVIDERS, type HostingAccount, type HostingProvider } from '../../../../shared/hosting';
import { invoke } from '../../api';
import { useAppState } from '../../state';
import { errorText, type ControlProps } from './SettingRow';

/** Hosting accounts: added with a server address and a token (checked with the server), removed with their token. */
export function AccountsEditor({ value }: ControlProps<'integrations.accounts'>) {
  const accounts = value as HostingAccount[];
  const secretStorage = useAppState((s) => s.app.secretStorage);
  const [form, setForm] = useState<{ provider: HostingProvider; url: string; token: string } | null>(null);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  // The form goes away: keep keyboard focus in Preferences (Escape closes it from there).
  const closeForm = () => {
    setForm(null);
    requestAnimationFrame(() => addRef.current?.focus());
  };

  const add = async () => {
    if (!form) return;
    setBusy(true);
    setStatus(null);
    try {
      const account = await invoke('hosting:add', form.provider, form.url, form.token);
      closeForm();
      setStatus({ error: false, text: `Signed in as ${account.username} on ${new URL(account.url).host}` });
    } catch (error) {
      setStatus({ error: true, text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hosting-accounts">
      <ul className="ssh-key-list">
        {accounts.map((account) => (
          <li key={account.id} data-account={account.id}>
            <span className="codicon codicon-account" aria-hidden="true" />
            <span className="ssh-key-name">{account.name && account.name !== account.username ? `${account.name} (${account.username})` : account.username}</span>
            <span className="ssh-key-meta">
              {PROVIDERS[account.provider].name} · {account.url}
            </span>
            <button
              type="button"
              onClick={() =>
                void invoke('hosting:remove', account.id).then(
                  () => setStatus(null),
                  (error: unknown) => setStatus({ error: true, text: errorText(error) }),
                )
              }
            >
              Remove
            </button>
          </li>
        ))}
        {accounts.length === 0 && <li className="empty-note">No accounts yet</li>}
      </ul>
      {form ? (
        <form
          className="account-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label>
            Service
            <select
              name="provider"
              value={form.provider}
              onChange={(event) => {
                const provider = event.target.value as HostingProvider;
                // The service's own server is filled in, unless the user typed another address.
                const typed = form.url.trim() && form.url !== PROVIDERS[form.provider].server;
                setForm({ ...form, provider, url: typed ? form.url : (PROVIDERS[provider].server ?? '') });
              }}
            >
              {(Object.keys(PROVIDERS) as HostingProvider[]).map((id) => (
                <option key={id} value={id}>
                  {PROVIDERS[id].name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Server address
            <input name="url" value={form.url} placeholder="https://code.example.com" autoFocus onChange={(event) => setForm({ ...form, url: event.target.value })} />
          </label>
          <label>
            Access token
            <input name="token" type="password" autoComplete="off" value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} />
          </label>
          <p className="hint">Create one on the server: {PROVIDERS[form.provider].tokenHelp}.</p>
          <div className="form-actions">
            <button type="submit" disabled={busy || !form.url.trim() || !form.token.trim()}>
              {busy ? 'Checking…' : 'Add account'}
            </button>
            <button type="button" onClick={closeForm} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" ref={addRef} disabled={!secretStorage} onClick={() => setForm({ provider: 'forgejo', url: '', token: '' })}>
          Add an account…
        </button>
      )}
      {!secretStorage && <p className="setting-error">No system keychain is available to Forklift, so tokens cannot be kept safely.</p>}
      {status && <p className={status.error ? 'setting-error' : 'setting-ok'}>{status.text}</p>}
    </div>
  );
}
