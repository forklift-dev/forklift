import type { ChangeKind, FileChange } from '../../../shared/state';

const KIND_LABEL: Record<ChangeKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  conflicted: '!',
};

function ChangeGroup({ title, changes }: { title: string; changes: FileChange[] }) {
  return (
    <div className="change-group">
      <h3>
        {title} <span className="count">{changes.length}</span>
      </h3>
      <ul>
        {changes.map((change) => (
          <li key={change.path} title={change.origPath ? `${change.origPath} → ${change.path}` : change.path}>
            <span className={`kind kind-${change.kind}`}>{KIND_LABEL[change.kind]}</span>
            {change.path}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChangesPanel({ changes }: { changes: FileChange[] }) {
  if (changes.length === 0) {
    return <aside className="changes empty-note">Working tree clean</aside>;
  }
  return (
    <aside className="changes">
      <ChangeGroup title="Unstaged" changes={changes.filter((c) => c.unstaged)} />
      <ChangeGroup title="Staged" changes={changes.filter((c) => c.staged)} />
    </aside>
  );
}
