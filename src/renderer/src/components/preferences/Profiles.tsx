import { useState } from 'react';
import { t } from '../../../../shared/i18n';
import type { KeysInfo, Profile, SigningFormat } from '../../../../shared/profiles';
import { invoke } from '../../api';
import { useAppState } from '../../state';
import { useCommand } from '../../useCommand';
import { tx } from '../../i18n';
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
    if (ok) setStatus({ error: false, text: t('Saved') });
    return ok;
  };
  const apply = async (root: string | null) => {
    if (dirty && !(await save())) return;
    setStatus(null);
    try {
      await invoke('profile:apply', profile.id, root);
      setStatus({ error: false, text: root ? t('In use in this repository') : t('In use for all repositories') });
    } catch (error) {
      setStatus({ error: true, text: errorText(error) });
    }
  };
  const sshKeys = keys?.ssh ?? [];
  return (
    <fieldset className="profile-form" data-profile={profile.id}>
      <legend>{profile.label}</legend>
      <label className="form-field">
        {t('Profile name')}
        <input type="text" name="label" {...field('label')} />
      </label>
      <div className="profile-row">
        <label className="form-field">
          {t('Name for commits')}
          <input type="text" name="userName" {...field('userName')} />
        </label>
        <label className="form-field">
          {t('Email')}
          <input type="text" name="email" {...field('email')} />
        </label>
      </div>
      <label className="form-field">
        {t('SSH key for remotes')}
        <select name="sshKey" {...field('sshKey')}>
          <option value="">{t('ssh’s own choice (agent, ~/.ssh/config)')}</option>
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
          {t('Sign commits')}
          <select name="signing" value={draft.signing} onChange={(event) => setDraft({ ...draft, signing: event.target.value as SigningFormat, signingKey: '' })}>
            <option value="none">{t('No')}</option>
            <option value="ssh">{t('With an SSH key')}</option>
            <option value="openpgp" disabled={keys?.gpg === null}>
              {keys?.gpg === null ? t('With GPG (gpg is not installed)') : t('With GPG')}
            </option>
          </select>
        </label>
        {draft.signing !== 'none' && (
          <label className="form-field">
            {t('Signing key')}
            <select name="signingKey" {...field('signingKey')}>
              <option value="">{t('Choose…')}</option>
              {draft.signing === 'ssh'
                ? sshKeys.map((key) => (
                    <option key={key.publicPath} value={key.publicPath}>
                      {key.publicPath}
                    </option>
                  ))
                : (keys?.gpg ?? []).map((key) => (
                    <option key={key.fingerprint} value={key.fingerprint} disabled={key.expired}>
                      {key.userIds[0] ?? key.id} ({key.id}){key.expired ? ` — ${t('expired')}` : ''}
                    </option>
                  ))}
            </select>
          </label>
        )}
      </div>
      <div className="profile-actions">
        <button type="button" disabled={!dirty} onClick={() => void save()}>
          {t('Save')}
        </button>
        <button type="button" onClick={() => void apply(null)}>
          {t('Use for all repositories')}
        </button>
        {repo && (
          <button type="button" onClick={() => void apply(repo)}>
            {t('Use for this repository')}
          </button>
        )}
        <button type="button" className="danger-text" onClick={onDelete}>
          {t('Delete')}
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
        label: profiles.length ? t('Profile {number}', { number: profiles.length + 1 }) : t('Default'),
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
        {t('Add a profile')}
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
    if (form.passphrase !== form.confirm) return setStatus({ error: true, text: t('The passphrases differ') });
    if (await run(() => invoke('keys:generateSsh', form.name, form.comment, form.passphrase), t('Created {name}', { name: form.name }))) setForm(null);
  };
  const defaultName = data?.ssh.some((key) => key.path.endsWith('/id_ed25519')) ? 'id_ed25519_forklift' : 'id_ed25519';
  return (
    <div className="ssh-keys">
      <h3>{t('SSH keys')}</h3>
      {error && <p className="setting-error">{error}</p>}
      {data && (
        <p className="hint">
          {data.agent.running
            ? tx('ssh-agent is running with {count} keys. Keys in {directory}:', { directory: <code>{data.sshDir}</code> }, { count: data.agent.fingerprints.length })
            : tx('No ssh-agent is running: keys with a passphrase will be asked for each time. Keys in {directory}:', { directory: <code>{data.sshDir}</code> })}
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
              {key.inAgent && ` · ${t('in agent')}`}
            </span>
            <button type="button" onClick={() => void run(async () => copyText(await invoke('keys:publicKey', key.publicPath)), t('Public key copied'))}>
              {t('Copy public key')}
            </button>
            {data.agent.running && !key.inAgent && (
              <button type="button" onClick={() => void run(() => invoke('keys:addToAgent', key.path), t('Added to the agent'))}>
                {t('Add to agent')}
              </button>
            )}
          </li>
        ))}
        {data && data.ssh.length === 0 && <li className="empty-note">{t('No keys yet')}</li>}
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
            {t('File name')}
            <input type="text" name="keyName" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="form-field">
            {t('Comment')}
            <input type="text" name="keyComment" value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} />
          </label>
          <label className="form-field">
            {t('Passphrase (optional)')}
            <input type="password" name="keyPassphrase" autoComplete="new-password" value={form.passphrase} onChange={(event) => setForm({ ...form, passphrase: event.target.value })} />
          </label>
          <label className="form-field">
            {t('Repeat the passphrase')}
            <input type="password" name="keyConfirm" autoComplete="new-password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} />
          </label>
          <div className="profile-actions">
            <button type="button" onClick={() => setForm(null)}>
              {t('Cancel')}
            </button>
            <button type="submit" className="primary" disabled={!form.name}>
              {t('Generate ed25519 key')}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setForm({ name: defaultName, comment: email, passphrase: '', confirm: '' })}>
          {t('Generate a key…')}
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
      <h3>{t('Saved passwords')}</h3>
      <p className="hint">
        {available
          ? t('For HTTPS remotes, when you tick “Remember” in the sign-in dialog. Encrypted with the system keychain; git’s own credential helpers are asked first.')
          : t('No system keychain is available to Forklift, so passwords are not saved (they are asked each time, unless your git credential helper keeps them).')}
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
              {t('Forget')}
            </button>
          </li>
        ))}
        {data && data.length === 0 && <li className="empty-note">{t('Nothing saved')}</li>}
      </ul>
    </div>
  );
}
