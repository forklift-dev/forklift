import { useState } from 'react';
import type { KeysInfo, Profile, SigningFormat } from '../../../../shared/profiles';
import { invoke } from '../../api';
import { useAppState } from '../../state';
import { useCommand } from '../../useCommand';
import { copyText } from '../ContextMenu';
import { errorText, type ControlProps } from './SettingRow';

const newId = (profiles: Profile[]) => {
  for (let i = profiles.length + 1; ; i++) if (!profiles.some((p) => p.id === `profile-${i}`)) return `profile-${i}`;
};

function ProfileForm({ profile, keys, onSave, onDelete, repo }: { profile: Profile; keys: KeysInfo | undefined; onSave(profile: Profile): Promise<boolean>; onDelete(): void; repo: string | null }) {
  const [draft, setDraft] = useState(profile);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const field = (name: keyof Profile) => ({
    value: draft[name],
    onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [name]: event.target.value })),
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  const save = async () => {
    setStatus(null);
    const ok = await onSave(draft);
    if (ok) setStatus({ error: false, text: 'Saved' });
    return ok;
  };
  const apply = async (root: string | null) => {
    if (dirty && !(await save())) return;
    setStatus(null);
    try {
      await invoke('profile:apply', profile.id, root);
      setStatus({ error: false, text: root ? 'In use in this repository' : 'In use for all repositories' });
    } catch (error) {
      setStatus({ error: true, text: errorText(error) });
    }
  };
  const sshKeys = keys?.ssh ?? [];
  return (
    <fieldset className="profile-form" data-profile={profile.id}>
      <legend>{profile.label}</legend>
      <label className="form-field">
        Profile name
        <input type="text" name="label" {...field('label')} />
      </label>
      <div className="profile-row">
        <label className="form-field">
          Name for commits
          <input type="text" name="userName" {...field('userName')} />
        </label>
        <label className="form-field">
          Email
          <input type="text" name="email" {...field('email')} />
        </label>
      </div>
      <label className="form-field">
        SSH key for remotes
        <select name="sshKey" {...field('sshKey')}>
          <option value="">ssh’s own choice (agent, ~/.ssh/config)</option>
          {sshKeys.map((key) => (
            <option key={key.path} value={key.path}>
              {key.path} ({key.type}{key.comment && `, ${key.comment}`})
            </option>
          ))}
          {draft.sshKey && !sshKeys.some((key) => key.path === draft.sshKey) && <option value={draft.sshKey}>{draft.sshKey}</option>}
        </select>
      </label>
      <div className="profile-row">
        <label className="form-field">
          Sign commits
          <select name="signing" value={draft.signing} onChange={(event) => setDraft({ ...draft, signing: event.target.value as SigningFormat, signingKey: '' })}>
            <option value="none">No</option>
            <option value="ssh">With an SSH key</option>
            <option value="openpgp" disabled={keys?.gpg === null}>
              With GPG{keys?.gpg === null ? ' (gpg is not installed)' : ''}
            </option>
          </select>
        </label>
        {draft.signing !== 'none' && (
          <label className="form-field">
            Signing key
            <select name="signingKey" {...field('signingKey')}>
              <option value="">Choose…</option>
              {draft.signing === 'ssh'
                ? sshKeys.map((key) => (
                    <option key={key.publicPath} value={key.publicPath}>
                      {key.publicPath}
                    </option>
                  ))
                : (keys?.gpg ?? []).map((key) => (
                    <option key={key.fingerprint} value={key.fingerprint} disabled={key.expired}>
                      {key.userIds[0] ?? key.id} ({key.id}){key.expired ? ' — expired' : ''}
                    </option>
                  ))}
            </select>
          </label>
        )}
      </div>
      <div className="profile-actions">
        <button type="button" disabled={!dirty} onClick={() => void save()}>
          Save
        </button>
        <button type="button" onClick={() => void apply(null)}>
          Use for all repositories
        </button>
        {repo && (
          <button type="button" onClick={() => void apply(repo)}>
            Use for this repository
          </button>
        )}
        <button type="button" className="danger-text" onClick={onDelete}>
          Delete
        </button>
        {status && <span className={status.error ? 'setting-error' : 'setting-ok'}>{status.text}</span>}
      </div>
    </fieldset>
  );
}

/** The saved profiles, each applicable globally or to the open repository. */
export function ProfilesEditor({ value, save }: ControlProps) {
  const profiles = value as Profile[];
  const activeRepo = useAppState((s) => s.repo.data?.root ?? null);
  // Generating a key reads the list again, for the profiles' key choices too.
  const [reload, setReload] = useState(0);
  const keys = useCommand('keys:list', [], { reloadKey: reload, keepPrevious: true });
  const identity = useCommand('profile:current', [null]);
  const replace = (index: number, profile: Profile | null) =>
    save(profile ? profiles.map((p, i) => (i === index ? profile : p)) : profiles.filter((_, i) => i !== index));
  const add = () =>
    void save([
      ...profiles,
      {
        id: newId(profiles),
        label: profiles.length ? `Profile ${profiles.length + 1}` : 'Default',
        userName: identity.data?.userName ?? '',
        email: identity.data?.email ?? '',
        sshKey: '',
        signing: 'none',
        signingKey: '',
      },
    ]);
  return (
    <div className="profiles">
      {profiles.map((profile, index) => (
        <ProfileForm key={profile.id} profile={profile} keys={keys.data} repo={activeRepo} onSave={(next) => replace(index, next)} onDelete={() => void replace(index, null)} />
      ))}
      <button type="button" onClick={add}>
        Add a profile
      </button>
      <SshKeys data={keys.data} error={keys.error} onChanged={() => setReload((n) => n + 1)} />
      <SavedPasswords />
    </div>
  );
}

/** ~/.ssh keys and the agent: copy a public key, load a key into the agent, generate a new one. */
function SshKeys({ data, error, onChanged }: { data: KeysInfo | undefined; error: string | null | undefined; onChanged(): void }) {
  const email = useAppState((s) => s.settings.values['profiles.list'][0]?.email ?? '');
  const [form, setForm] = useState<{ name: string; comment: string; passphrase: string; confirm: string } | null>(null);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const run = async (action: () => Promise<unknown>, done: string) => {
    setStatus(null);
    try {
      await action();
      setStatus({ error: false, text: done });
      onChanged();
      return true;
    } catch (failure) {
      setStatus({ error: true, text: errorText(failure) });
      return false;
    }
  };
  const generate = async () => {
    if (!form) return;
    if (form.passphrase !== form.confirm) return setStatus({ error: true, text: 'The passphrases differ' });
    if (await run(() => invoke('keys:generateSsh', form.name, form.comment, form.passphrase), `Created ${form.name}`)) setForm(null);
  };
  const defaultName = data?.ssh.some((key) => key.path.endsWith('/id_ed25519')) ? 'id_ed25519_forklift' : 'id_ed25519';
  return (
    <div className="ssh-keys">
      <h3>SSH keys</h3>
      {error && <p className="setting-error">{error}</p>}
      {data && (
        <p className="hint">
          {data.agent.running ? `ssh-agent is running with ${data.agent.fingerprints.length} key${data.agent.fingerprints.length === 1 ? '' : 's'}.` : 'No ssh-agent is running: keys with a passphrase will be asked for each time.'} Keys in{' '}
          <code>{data.sshDir}</code>:
        </p>
      )}
      <ul className="ssh-key-list">
        {data?.ssh.map((key) => (
          <li key={key.path} data-key={key.path}>
            <span className="codicon codicon-key" aria-hidden="true" />
            <span className="ssh-key-name">{key.path.split(/[\\/]/).pop()}</span>
            <span className="ssh-key-meta">
              {key.type} · {key.fingerprint}
              {key.comment && ` · ${key.comment}`}
              {key.inAgent && ' · in agent'}
            </span>
            <button type="button" onClick={() => void run(async () => copyText(await invoke('keys:publicKey', key.publicPath)), 'Public key copied')}>
              Copy public key
            </button>
            {data.agent.running && !key.inAgent && (
              <button type="button" onClick={() => void run(() => invoke('keys:addToAgent', key.path), 'Added to the agent')}>
                Add to agent
              </button>
            )}
          </li>
        ))}
        {data && data.ssh.length === 0 && <li className="empty-note">No keys yet</li>}
      </ul>
      {form ? (
        <form
          className="ssh-generate"
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <label className="form-field">
            File name
            <input type="text" name="keyName" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="form-field">
            Comment
            <input type="text" name="keyComment" value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} />
          </label>
          <label className="form-field">
            Passphrase (optional)
            <input type="password" name="keyPassphrase" autoComplete="new-password" value={form.passphrase} onChange={(event) => setForm({ ...form, passphrase: event.target.value })} />
          </label>
          <label className="form-field">
            Repeat the passphrase
            <input type="password" name="keyConfirm" autoComplete="new-password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} />
          </label>
          <div className="profile-actions">
            <button type="button" onClick={() => setForm(null)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!form.name}>
              Generate ed25519 key
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setForm({ name: defaultName, comment: email, passphrase: '', confirm: '' })}>
          Generate a key…
        </button>
      )}
      {status && <p className={status.error ? 'setting-error' : 'setting-ok'}>{status.text}</p>}
    </div>
  );
}

/** HTTPS usernames and passwords the app remembered; each can be forgotten. */
function SavedPasswords() {
  const [reload, setReload] = useState(0);
  const { data } = useCommand('credentials:list', [], { reloadKey: reload, keepPrevious: true });
  const available = useAppState((s) => s.app.secretStorage);
  return (
    <div className="ssh-keys saved-passwords">
      <h3>Saved passwords</h3>
      <p className="hint">
        {available
          ? 'For HTTPS remotes, when you tick “Remember” in the sign-in dialog. Encrypted with the system keychain; git’s own credential helpers are asked first.'
          : 'No system keychain is available to Forklift, so passwords are not saved (they are asked each time, unless your git credential helper keeps them).'}
      </p>
      <ul className="ssh-key-list">
        {data?.map((entry) => (
          <li key={entry.id} data-credential={entry.host}>
            <span className="codicon codicon-lock" aria-hidden="true" />
            <span className="ssh-key-name">{entry.username}</span>
            <span className="ssh-key-meta">
              {entry.protocol}://{entry.host}
              {entry.path && `/${entry.path}`}
            </span>
            <button type="button" onClick={() => void invoke('credentials:remove', entry.id).then(() => setReload((n) => n + 1))}>
              Forget
            </button>
          </li>
        ))}
        {data && data.length === 0 && <li className="empty-note">Nothing saved</li>}
      </ul>
    </div>
  );
}
