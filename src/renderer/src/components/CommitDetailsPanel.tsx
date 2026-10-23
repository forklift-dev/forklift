import type { ReactNode } from 'react';
import type { CommitFile, FileChangeStatus } from '../../../shared/diff';
import type { SignatureStatus } from '../../../shared/profiles';
import { useCommand } from '../useCommand';
import { Avatar } from './Avatar';
import { IssueRefs } from './HostingView';

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
  /** Extra header content: actions for a stash. */
  actions?: ReactNode;
  onFileHistory?(path: string): void;
  /** `#123` in the message opens that issue or pull request (when the repository's server is known). */
  onOpenIssue?(number: number): void;
}

const SIGNATURE_TEXT: Record<SignatureStatus, string> = {
  good: 'Verified',
  untrusted: 'Valid, key not trusted',
  expired: 'Valid, signature expired',
  'expired-key': 'Valid, key expired',
  revoked: 'Key revoked',
  bad: 'Bad signature',
  unverifiable: 'Cannot be checked',
  none: '',
};

/** The commit's signature, checked in the background (gpg or ssh-keygen can take a moment). */
function Signature({ repo, sha }: { repo: string; sha: string }) {
  const { data } = useCommand('commit:signature', [repo, sha]);
  if (!data || data.status === 'none') return null;
  const ok = data.status === 'good';
  const warn = data.status === 'untrusted' || data.status === 'expired' || data.status === 'expired-key';
  const format = data.format === 'ssh' ? 'SSH' : data.format === 'x509' ? 'X.509' : 'GPG';
  return (
    <>
      <dt>Signed</dt>
      <dd className={`signature ${ok ? 'good' : warn ? 'warn' : 'bad'}`} data-status={data.status} title={data.key ? `${format} key ${data.key}` : undefined}>
        <span className={`codicon ${ok ? 'codicon-verified-filled' : warn ? 'codicon-warning' : 'codicon-error'}`} aria-hidden="true" /> {SIGNATURE_TEXT[data.status]} · {format}
        {data.signer && ` · ${data.signer}`}
        {data.status === 'unverifiable' && data.format === 'ssh' && <span className="signature-hint"> (add the key to a profile or to gpg.ssh.allowedSignersFile)</span>}
      </dd>
    </>
  );
}

export function CommitDetailsPanel({ repo, sha, selectedPath, onOpenFile, onClose, actions, onFileHistory, onOpenIssue }: CommitDetailsPanelProps) {
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
      {actions && <div className="commit-details-actions">{actions}</div>}
      <h2 className="commit-subject">
        <IssueRefs text={subject} onOpen={onOpenIssue} />
      </h2>
      {body && (
        <pre className="commit-body">
          <IssueRefs text={body} onOpen={onOpenIssue} />
        </pre>
      )}
      <dl className="commit-meta">
        <dt>Author</dt>
        <dd title={data.author.email} className="commit-person">
          <Avatar name={data.author.name} email={data.author.email} size={20} />
          {data.author.name} · {dateFormat.format(data.author.time * 1000)}
        </dd>
        {!sameCommitter && (
          <>
            <dt>Committer</dt>
            <dd title={data.committer.email} className="commit-person">
              <Avatar name={data.committer.name} email={data.committer.email} size={20} />
              {data.committer.name} · {dateFormat.format(data.committer.time * 1000)}
            </dd>
          </>
        )}
        <Signature repo={repo} sha={sha} />
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
            <li key={`${file.sourceSha ?? ''}:${file.path}`} className="change-row">
              <button
                type="button"
                className={`change-item${file.path === selectedPath ? ' selected' : ''}`}
                title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                onClick={() => onOpenFile(file)}
              >
                <span className={`kind ${STATUS_CLASS[file.status]}`}>{STATUS_LABEL[file.status]}</span>
                {file.path}
                {file.sourceSha && <span className="untracked-note">untracked</span>}
              </button>
              {onFileHistory && !file.sourceSha && (
                <button type="button" className="icon-button row-history" aria-label={`History of ${file.path}`} title="File history and blame" onClick={() => onFileHistory(file.path)}>
                  <span className="codicon codicon-history" aria-hidden="true" />
                </button>
              )}
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
