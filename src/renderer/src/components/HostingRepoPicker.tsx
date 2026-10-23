import { useState } from 'react';
import type { HostingRepo } from '../../../shared/hosting';
import { useAppState } from '../state';
import { useCommand } from '../useCommand';

/** Repositories of the accounts in Preferences → Integrations, for the Clone dialog; picking one fills the URL. */
export function HostingRepoPicker({ selectedUrl, onPick }: { selectedUrl: string; onPick(repo: HostingRepo): void }) {
  const accounts = useAppState((s) => s.settings.values['integrations.accounts']);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [filter, setFilter] = useState('');
  const account = accounts.find((candidate) => candidate.id === accountId) ?? accounts[0];
  const { data, error, loading } = useCommand(account ? 'hosting:repos' : null, [account?.id ?? '']);
  if (!account) return null;
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (data ?? []).filter((repo) => words.every((word) => `${repo.fullName} ${repo.description}`.toLowerCase().includes(word)));
  return (
    <div className="form-field hosting-repo-picker">
      <span className="hosting-picker-head">
        From
        {accounts.length > 1 ? (
          <select aria-label="Account" value={account.id} onChange={(event) => setAccountId(event.target.value)}>
            {accounts.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.username} · {new URL(candidate.url).host}
              </option>
            ))}
          </select>
        ) : (
          <strong>
            {account.username} · {new URL(account.url).host}
          </strong>
        )}
        <input type="search" aria-label="Filter repositories" placeholder="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
      </span>
      <ul className="hosting-repo-list" aria-label="Repositories on the server">
        {error && <li className="setting-error">{error}</li>}
        {loading && !data && <li className="empty-note">Loading…</li>}
        {data && shown.length === 0 && <li className="empty-note">No repositories</li>}
        {shown.map((repo) => (
          <li key={repo.fullName}>
            <button type="button" className={repo.cloneUrl === selectedUrl ? 'selected' : undefined} data-repo={repo.fullName} title={repo.description || repo.fullName} onClick={() => onPick(repo)}>
              <span className={`codicon ${repo.private ? 'codicon-lock' : 'codicon-repo'}`} aria-hidden="true" />
              <span className="hosting-repo-name">{repo.fullName}</span>
              {repo.description && <span className="hosting-repo-description">{repo.description}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
