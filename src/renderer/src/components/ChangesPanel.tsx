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

export interface FileActions {
  onOpenFile(path: string): void;
  onDiffFile(path: string, staged: boolean): void;
  onMergeFile(path: string): void;
}

interface ChangeGroupProps extends FileActions {
  title: string;
  staged: boolean;
  changes: FileChange[];
}

function ChangeGroup({ title, staged, changes, onOpenFile, onDiffFile, onMergeFile }: ChangeGroupProps) {
  return (
    <div className="change-group">
      <h3>
        {title} <span className="count">{changes.length}</span>
      </h3>
      <ul>
        {changes.map((change) => {
          const label = change.origPath ? `${change.origPath} → ${change.path}` : change.path;
          const conflicted = change.kind === 'conflicted';
          // Untracked files have nothing to compare against yet.
          const diffable = !conflicted && change.kind !== 'untracked';
          return (
            <li key={change.path} className="change-row">
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
              {diffable && (
                <button type="button" className="change-action" title="Open in diff tool" onClick={() => onDiffFile(change.path, staged)}>
                  Diff
                </button>
              )}
              {conflicted && (
                <button type="button" className="change-action" title="Resolve in merge tool" onClick={() => onMergeFile(change.path)}>
                  Merge
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ChangesPanel({ changes, ...actions }: { changes: FileChange[] } & FileActions) {
  if (changes.length === 0) {
    return <aside className="changes empty-note">Working tree clean</aside>;
  }
  return (
    <aside className="changes">
      <ChangeGroup title="Unstaged" staged={false} changes={changes.filter((c) => c.unstaged)} {...actions} />
      <ChangeGroup title="Staged" staged changes={changes.filter((c) => c.staged)} {...actions} />
    </aside>
  );
}
