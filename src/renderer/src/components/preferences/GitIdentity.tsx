import { useState } from 'react';
import { t } from '../../../../shared/i18n';
import type { GitIdentity } from '../../../../shared/settings';
import { invoke } from '../../api';
import { useCommand } from '../../useCommand';
import { errorText } from './SettingRow';

/** user.name / user.email from git config: global (`repo` null), or the repository's own. */
export function GitIdentityEditor({ repo }: { repo: string | null }) {
  const { data, error } = useCommand('git:identity', [repo]);
  const scope = repo ? 'repository' : 'global';
  return (
    <div className="setting-row" data-setting="git.identity">
      <div className="setting-text">
        <label htmlFor={`identity-${scope}-name`}>{t('Commit author')}</label>
        <p>
          {scope === 'global'
            ? t('user.name and user.email in your global git config (~/.gitconfig): git uses them everywhere, not only in Forklift.')
            : t("user.name and user.email in this repository's .git/config. Leave empty to use the global identity.")}
        </p>
      </div>
      <div className="setting-control">
        {error && <p className="setting-error">{error}</p>}
        {data && <IdentityForm repo={repo} initial={data} />}
      </div>
    </div>
  );
}

function IdentityForm({ repo, initial }: { repo: string | null; initial: GitIdentity }) {
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const changed = name !== saved.name || email !== saved.email;

  const save = async () => {
    try {
      await invoke('git:setIdentity', repo, { name, email });
      const trimmed = { name: name.trim(), email: email.trim() };
      setSaved(trimmed);
      setName(trimmed.name);
      setEmail(trimmed.email);
      setStatus({ text: t('Saved'), ok: true });
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
      <input id={`identity-${repo ? 'repository' : 'global'}-name`} aria-label={t('Name')} placeholder={t('Name')} value={name} maxLength={256} onChange={(e) => setName(e.target.value)} />
      <input aria-label={t('Email')} placeholder={t('Email')} type="email" value={email} maxLength={256} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit" disabled={!changed}>
        {t('Save')}
      </button>
      {status && <p className={status.ok ? 'tool-status' : 'setting-error'}>{status.text}</p>}
    </form>
  );
}
