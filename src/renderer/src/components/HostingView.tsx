import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { PROVIDERS, pullTerm, refLabel, type HostingComment, type HostingProvider, type IssueDetails, type PullDetails, type RepoHosting } from '../../../shared/hosting';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { useCommand } from '../useCommand';

export type HostingItem = { kind: 'pull' | 'issue'; number: number };

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const when = (iso: string) => (iso ? dateFormat.format(new Date(iso)) : '');

/**
 * Text with `#123` (and on GitLab `!123`, a merge request) turned into links to that issue or pull request,
 * shown in the app.
 */
export function IssueRefs({ text, provider, onOpen }: { text: string; provider?: HostingProvider; onOpen?(item: HostingItem): void }): ReactNode {
  if (!onOpen) return text;
  const marks = provider && PROVIDERS[provider].mergeRefs ? '#!' : '#';
  const parts = text.split(new RegExp(`(?<![\\w&/#!])([${marks}])(\\d{1,7})\\b`));
  const nodes: ReactNode[] = [];
  for (let index = 0; index < parts.length; index += 3) {
    nodes.push(<Fragment key={index}>{parts[index]}</Fragment>);
    if (index + 2 >= parts.length) break;
    const [mark, number] = [parts[index + 1]!, Number(parts[index + 2])];
    const item: HostingItem = { kind: mark === '!' ? 'pull' : 'issue', number };
    nodes.push(
      <button key={`${index}-ref`} type="button" className="link-button issue-ref" onClick={() => onOpen(item)} title={`Show ${mark}${number}`}>
        {mark}
        {number}
      </button>,
    );
  }
  return nodes;
}

interface HostingViewProps {
  repo: string;
  hosting: RepoHosting;
  item: HostingItem;
  /** Bumped when lists should re-read (a comment was added). */
  onChanged(): void;
  onOpen(item: HostingItem): void;
  /** Shows a commit in the graph, when it is in the local history. */
  onShowCommit(sha: string): void;
  run: RunAction;
  onClose(): void;
}

/** A pull request or issue in the center: description, commits and files (pull requests), and the discussion. */
export function HostingView({ repo, hosting, item, onChanged, onOpen, onShowCommit, run, onClose }: HostingViewProps) {
  const [reload, setReload] = useState(0);
  const pull = useCommand(item.kind === 'pull' ? 'hosting:pull' : null, [repo, item.number], { reloadKey: reload });
  const issue = useCommand(item.kind === 'issue' ? 'hosting:issue' : null, [repo, item.number], { reloadKey: reload });
  const { data, error } = item.kind === 'pull' ? pull : issue;
  // An issue number may turn out to be a pull request (Forgejo and GitHub number them together).
  useEffect(() => {
    if (item.kind === 'issue' && (issue.data as IssueDetails | undefined)?.isPull) onOpen({ kind: 'pull', number: item.number });
  }, [item, issue.data, onOpen]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && !event.defaultPrevented && !(event.target as HTMLElement | null)?.closest?.('textarea, input') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const what = item.kind === 'pull' ? pullTerm(hosting.account.provider) : 'Issue';
  const details = data as (PullDetails | IssueDetails) | undefined;
  const pullDetails = item.kind === 'pull' ? (data as PullDetails | undefined) : undefined;
  const provider = hosting.account.provider;

  return (
    <section className="hosting-view" aria-label={`${what} ${refLabel(hosting.account.provider, item.kind, item.number)}`}>
      <header className="diff-header">
        <div className="diff-title">
          <strong>
            {refLabel(hosting.account.provider, item.kind, item.number)} {details?.title ?? ''}
          </strong>
          <span className="diff-subtitle">
            {what.toLowerCase()} · {hosting.owner}/{hosting.name}
          </span>
        </div>
        <div className="diff-toolbar">
          {pullDetails && pullDetails.state === 'open' && (
            <button type="button" onClick={() => void run(() => invoke('hosting:checkoutPull', repo, item.number))} title={pullDetails.headRepo ? `Fetch it as the local branch pr/${item.number}` : `Fetch and switch to ${pullDetails.head}`}>
              Check out
            </button>
          )}
          {details?.webUrl && (
            <a className="button-link" href={details.webUrl} target="_blank" rel="noreferrer" title="Open on the server">
              <span className="codicon codicon-link-external" aria-hidden="true" /> Open in browser
            </a>
          )}
          <button type="button" onClick={() => setReload((n) => n + 1)} aria-label="Reload" title="Reload">
            <span className="codicon codicon-refresh" aria-hidden="true" />
          </button>
          <button type="button" onClick={onClose} aria-label={`Close ${what.toLowerCase()}`} title="Close (Esc)">
            ✕
          </button>
        </div>
      </header>
      {error ? (
        <div className="diff-message error">{error}</div>
      ) : !details ? (
        <div className="diff-message">Loading…</div>
      ) : (
        <div className="hosting-body">
          <div className="hosting-meta">
            <span className={`hosting-state state-${details.state}`}>{details.state}</span>
            {pullDetails?.draft && <span className="hosting-state state-draft">draft</span>}
            <span>
              {details.author} opened {when(details.createdAt)}
            </span>
            {pullDetails && (
              <span className="hosting-branches">
                <span className="branch">{pullDetails.headRepo ? `${pullDetails.headRepo}:${pullDetails.head}` : pullDetails.head}</span> → <span className="branch">{pullDetails.base}</span>
              </span>
            )}
            {pullDetails?.state === 'open' && pullDetails.mergeable === false && <span className="setting-error">has conflicts with {pullDetails.base}</span>}
            {'labels' in details &&
              details.labels.map((label) => (
                <span key={label.name} className="hosting-label" style={{ borderColor: /^[0-9a-f]{6}$/i.test(label.color) ? `#${label.color}` : undefined }}>
                  {label.name}
                </span>
              ))}
          </div>
          <div className="hosting-text">{details.body.trim() ? <IssueRefs text={details.body} provider={provider} onOpen={onOpen} /> : <span className="empty-note">No description</span>}</div>
          {pullDetails && (
            <>
              <h3>
                Commits <span className="count">{pullDetails.commits.length}</span>
              </h3>
              <ul className="hosting-commits">
                {pullDetails.commits.map((commit) => (
                  <li key={commit.sha}>
                    <button type="button" className="link-button hash" onClick={() => onShowCommit(commit.sha)} title="Show in the graph (after fetching)">
                      {commit.sha.slice(0, 7)}
                    </button>
                    <span className="hosting-commit-subject">{commit.message.split('\n')[0]}</span>
                    <span className="history-meta">{commit.author}</span>
                  </li>
                ))}
              </ul>
              <h3>
                Files <span className="count">{pullDetails.files.length}</span>
              </h3>
              <ul className="hosting-files">
                {pullDetails.files.map((file) => (
                  <li key={file.path}>
                    <span className="hosting-file">{file.path}</span>
                    <span className="line-stats">
                      <span className="kind-added">+{file.additions}</span> <span className="kind-deleted">−{file.deletions}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>
            Discussion <span className="count">{details.discussion.length}</span>
          </h3>
          <ol className="hosting-discussion">
            {details.discussion.map((comment) => (
              <Comment key={comment.id} comment={comment} provider={provider} onOpenRef={onOpen} />
            ))}
          </ol>
          <CommentForm
            onSubmit={async (body) => {
              await invoke('hosting:comment', repo, item.kind, item.number, body);
              setReload((n) => n + 1);
              onChanged();
            }}
          />
        </div>
      )}
    </section>
  );
}

function Comment({ comment, provider, onOpenRef }: { comment: HostingComment; provider: HostingProvider; onOpenRef(item: HostingItem): void }) {
  return (
    <li className="hosting-comment" data-comment={comment.id}>
      <div className="history-meta">
        <strong>{comment.author}</strong> · {when(comment.createdAt)}
      </div>
      <div className="hosting-text">
        <IssueRefs text={comment.body} provider={provider} onOpen={onOpenRef} />
      </div>
    </li>
  );
}

function CommentForm({ onSubmit }: { onSubmit(body: string): Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text);
      setText('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="hosting-comment-form"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <textarea
        aria-label="New comment"
        placeholder="Leave a comment (Ctrl+Enter sends)"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && text.trim()) {
            event.preventDefault();
            void send();
          }
        }}
      />
      {error && <p className="setting-error">{error}</p>}
      <button type="submit" disabled={busy || !text.trim()}>
        {busy ? 'Sending…' : 'Comment'}
      </button>
    </form>
  );
}
