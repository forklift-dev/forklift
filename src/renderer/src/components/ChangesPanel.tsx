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

interface ChangeGroupProps {
  title: string;
  changes: FileChange[];
  onOpenFile(path: string): void;
}

function ChangeGroup({ title, changes, onOpenFile }: ChangeGroupProps) {
  return (
    <div className="change-group">
      <h3>
        {title} <span className="count">{changes.length}</span>
      </h3>
      <ul>
        {changes.map((change) => {
          const label = change.origPath ? `${change.origPath} → ${change.path}` : change.path;
          return (
            <li key={change.path}>
              <button
                type="button"
                className="change-item"
                title={change.kind === 'deleted' ? label : `${label}\nOpen in editor`}
                disabled={change.kind === 'deleted'}
                onClick={() => onOpenFile(change.path)}
              >
                <span className={`kind kind-${change.kind}`}>{KIND_LABEL[change.kind]}</span>
                {change.path}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ChangesPanel({ changes, onOpenFile }: { changes: FileChange[]; onOpenFile(path: string): void }) {
  if (changes.length === 0) {
    return <aside className="changes empty-note">Working tree clean</aside>;
  }
  return (
    <aside className="changes">
      <ChangeGroup title="Unstaged" changes={changes.filter((c) => c.unstaged)} onOpenFile={onOpenFile} />
      <ChangeGroup title="Staged" changes={changes.filter((c) => c.staged)} onOpenFile={onOpenFile} />
    </aside>
  );
}
