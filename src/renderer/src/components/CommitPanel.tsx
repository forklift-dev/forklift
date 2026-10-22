import { useState, type KeyboardEvent } from 'react';
import { invoke } from '../api';

interface CommitPanelProps {
  stagedCount: number;
  /** HEAD commit, or null in a repository without commits (nothing to amend). */
  headSha: string | null;
  onCommit(message: string, amend: boolean): Promise<boolean>;
}

export function CommitPanel({ stagedCount, headSha, onCommit }: CommitPanelProps) {
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [amend, setAmend] = useState(false);
  const [committing, setCommitting] = useState(false);

  const canCommit = summary.trim() !== '' && (amend || stagedCount > 0) && !committing;

  const toggleAmend = async (checked: boolean) => {
    setAmend(checked);
    // Start from the message being amended unless the user already typed one.
    if (checked && headSha && !summary && !description) {
      const { message } = await invoke('commit:details', headSha);
      const [subject = '', ...body] = message.trimEnd().split('\n');
      setSummary(subject);
      setDescription(body.join('\n').trim());
    }
  };

  const commit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}\n` : `${summary.trim()}\n`;
    const ok = await onCommit(message, amend);
    setCommitting(false);
    if (ok) {
      setSummary('');
      setDescription('');
      setAmend(false);
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
      <div className="commit-actions">
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
