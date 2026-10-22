import type { CommitFile, FileChangeStatus } from '../../../shared/diff';
import { useCommand } from '../useCommand';

const STATUS_LABEL: Record<FileChangeStatus, string> = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
};

const STATUS_CLASS: Record<FileChangeStatus, string> = {
  added: 'kind-added',
  deleted: 'kind-deleted',
  modified: 'kind-modified',
  renamed: 'kind-renamed',
  copied: 'kind-copied',
  typechange: 'kind-typechange',
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

interface CommitDetailsPanelProps {
  repo: string;
  sha: string;
  selectedPath: string | null;
  onOpenFile(file: CommitFile): void;
  onClose(): void;
}

export function CommitDetailsPanel({ repo, sha, selectedPath, onOpenFile, onClose }: CommitDetailsPanelProps) {
  const { data, error } = useCommand('commit:details', [repo, sha]);

  if (error) return <div className="changes commit-details diff-message error">{error}</div>;
  if (!data) return <div className="changes commit-details empty-note">Loading…</div>;

  const [subject = '', ...rest] = data.message.trimEnd().split('\n');
  const body = rest.join('\n').trim();
  const sameCommitter = data.committer.name === data.author.name && data.committer.email === data.author.email;

  return (
    <div className="changes commit-details">
      <div className="commit-details-header">
        <span className="hash" title={data.hash}>
          {data.hash.slice(0, 10)}
        </span>
        <button type="button" className="close-details" onClick={onClose} title="Back to working changes">
          ✕
        </button>
      </div>
      <h2 className="commit-subject">{subject}</h2>
      {body && <pre className="commit-body">{body}</pre>}
      <dl className="commit-meta">
        <dt>Author</dt>
        <dd title={data.author.email}>
          {data.author.name} · {dateFormat.format(data.author.time * 1000)}
        </dd>
        {!sameCommitter && (
          <>
            <dt>Committer</dt>
            <dd title={data.committer.email}>
              {data.committer.name} · {dateFormat.format(data.committer.time * 1000)}
            </dd>
          </>
        )}
        {data.parents.length > 0 && (
          <>
            <dt>{data.parents.length > 1 ? 'Parents' : 'Parent'}</dt>
            <dd className="hash">{data.parents.map((p) => p.slice(0, 7)).join(' ')}</dd>
          </>
        )}
      </dl>
      <div className="change-group">
        <h3>
          Files <span className="count">{data.files.length}</span>
        </h3>
        <ul>
          {data.files.map((file) => (
            <li key={file.path} className="change-row">
              <button
                type="button"
                className={`change-item${file.path === selectedPath ? ' selected' : ''}`}
                title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                onClick={() => onOpenFile(file)}
              >
                <span className={`kind ${STATUS_CLASS[file.status]}`}>{STATUS_LABEL[file.status]}</span>
                {file.path}
              </button>
              {!data.statsOmitted && !file.binary && (
                <span className="line-stats">
                  <span className="kind-added">+{file.additions}</span> <span className="kind-deleted">−{file.deletions}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
