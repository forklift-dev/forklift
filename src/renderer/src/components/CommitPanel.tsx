import { useState, type KeyboardEvent } from 'react';
import { invoke } from '../api';
import { useAppState } from '../state';
import { useCommand } from '../useCommand';

interface CommitPanelProps {
  repo: string;
  stagedCount: number;
  /** HEAD commit, or null in a repository without commits (nothing to amend). */
  headSha: string | null;
  onCommit(message: string, amend: boolean, skipHooks: boolean): Promise<boolean>;
  /** A message git prepared (merge, squash): the form starts with it. */
  preparedMessage?: string | null;
  /** Changes when the repository was read again (the identity may have changed). */
  loadedAt?: number;
}

/** Who the commit will be by (and whether it is signed), naming the profile when it matches one. */
function CommitIdentity({ repo, reloadKey }: { repo: string; reloadKey: unknown }) {
  const profiles = useAppState((s) => s.settings.values['profiles.list']);
  const { data } = useCommand('profile:current', [repo], { reloadKey: [reloadKey, profiles], keepPrevious: true });
  if (!data) return null;
  const profile = profiles.find((p) => p.id === data.current);
  return (
    <p className="commit-identity" title="Change it with a profile: Preferences → Profiles and keys, or “Switch profile…” in the command palette">
      {data.userName || data.email ? (
        <>
          as {data.userName || '(no name)'} &lt;{data.email || 'no email'}&gt;
          {profile && <span className="commit-profile"> · {profile.label}</span>}
          {data.signing && (
            <span className="commit-signing">
              {' '}
              · <span className="codicon codicon-verified" aria-hidden="true" /> signed
            </span>
          )}
        </>
      ) : (
        <span className="setting-error">No name and email for commits: set them in Preferences → Git or with a profile</span>
      )}
    </p>
  );
}

export function CommitPanel({ repo, stagedCount, headSha, onCommit, preparedMessage, loadedAt }: CommitPanelProps) {
  const [prepared = '', ...preparedBody] = (preparedMessage ?? '').split('\n');
  const [summary, setSummary] = useState(prepared);
  const [description, setDescription] = useState(preparedBody.join('\n').trim());
  const [amend, setAmend] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [skipHooks, setSkipHooks] = useState(false);
  const hooks = useCommand('hooks:list', [repo], { reloadKey: loadedAt, keepPrevious: true });
  const verifyHooks = (hooks.data?.hooks ?? []).filter((hook) => hook === 'pre-commit' || hook === 'commit-msg');
  const running = useAppState((s) => (s.repo.hooks?.operation === 'commit' ? s.repo.hooks : null));

  const canCommit = summary.trim() !== '' && (amend || stagedCount > 0) && !committing;

  const toggleAmend = async (checked: boolean) => {
    setAmend(checked);
    // Start from the message being amended unless the user already typed one.
    if (checked && headSha && !summary && !description) {
      const { message } = await invoke('commit:details', repo, headSha);
      const [subject = '', ...body] = message.trimEnd().split('\n');
      setSummary(subject);
      setDescription(body.join('\n').trim());
    }
  };

  const commit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}\n` : `${summary.trim()}\n`;
    const ok = await onCommit(message, amend, skipHooks && verifyHooks.length > 0);
    setCommitting(false);
    if (ok) {
      setSummary('');
      setDescription('');
      setAmend(false);
      // Skipping hooks is a one-off choice.
      setSkipHooks(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void commit();
    }
  };

  return (
    <form
      className="commit-panel"
      onSubmit={(event) => {
        event.preventDefault();
        void commit();
      }}
    >
      <input
        className="commit-summary"
        placeholder="Summary"
        aria-label="Commit summary"
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <textarea
        className="commit-description"
        placeholder="Description"
        aria-label="Commit description"
        rows={3}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <CommitIdentity repo={repo} reloadKey={loadedAt} />
      {running && (
        <div className="hook-activity" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Running {running.hooks.join(', ')} hook{running.hooks.length === 1 ? '' : 's'}…
          {running.output.length > 0 && <pre className="hook-output">{running.output.slice(-8).join('\n')}</pre>}
        </div>
      )}
      <div className="commit-actions">
        {verifyHooks.length > 0 && (
          <label className={skipHooks ? 'skip-hooks on' : 'skip-hooks'} title={`Commit with --no-verify: the ${verifyHooks.join(' and ')} hook${verifyHooks.length === 1 ? '' : 's'} (${hooks.data?.dir}) will not check this commit`}>
            <input type="checkbox" name="skipHooks" checked={skipHooks} onChange={(event) => setSkipHooks(event.target.checked)} /> Skip hooks
          </label>
        )}
        <label title={headSha ? 'Replace the last commit' : 'Nothing to amend yet'}>
          <input type="checkbox" checked={amend} disabled={!headSha} onChange={(event) => void toggleAmend(event.target.checked)} /> Amend
        </label>
        <button type="submit" className="primary" disabled={!canCommit} title="Commit (Ctrl/Cmd+Enter)">
          {committing ? 'Committing…' : amend ? 'Amend commit' : `Commit ${stagedCount} file${stagedCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </form>
  );
}
