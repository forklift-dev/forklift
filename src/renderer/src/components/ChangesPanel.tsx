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
  /** Built-in diff: the primary action. */
  onShowDiff(change: FileChange, staged: boolean): void;
  onOpenInEditor(path: string): void;
  onExternalDiff(path: string, staged: boolean): void;
  onExternalMerge(path: string): void;
}

interface ChangeGroupProps extends FileActions {
  title: string;
  staged: boolean;
  changes: FileChange[];
  selected: { path: string; staged: boolean } | null;
}

function ChangeGroup({ title, staged, changes, selected, onShowDiff, onOpenInEditor, onExternalDiff, onExternalMerge }: ChangeGroupProps) {
  return (
    <div className="change-group">
      <h3>
        {title} <span className="count">{changes.length}</span>
      </h3>
      <ul>
        {changes.map((change) => {
          const label = change.origPath ? `${change.origPath} → ${change.path}` : change.path;
          const conflicted = change.kind === 'conflicted';
          const isSelected = selected?.path === change.path && selected.staged === staged;
          return (
            <li key={change.path} className="change-row">
              <button
                type="button"
                className={`change-item${isSelected ? ' selected' : ''}`}
                title={`${label}\nShow changes`}
                onClick={() => onShowDiff(change, staged)}
              >
                <span className={`kind kind-${change.kind}`}>{KIND_LABEL[change.kind]}</span>
                {change.path}
              </button>
              {change.kind !== 'deleted' && (
                <button type="button" className="change-action" title="Open in editor" onClick={() => onOpenInEditor(change.path)}>
                  Edit
                </button>
              )}
              {conflicted ? (
                <button type="button" className="change-action" title="Resolve in external merge tool" onClick={() => onExternalMerge(change.path)}>
                  Merge
                </button>
              ) : (
                change.kind !== 'untracked' && (
                  <button type="button" className="change-action" title="Open in external diff tool" onClick={() => onExternalDiff(change.path, staged)}>
                    Ext
                  </button>
                )
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface ChangesPanelProps extends FileActions {
  changes: FileChange[];
  selected: { path: string; staged: boolean } | null;
}

export function ChangesPanel({ changes, ...rest }: ChangesPanelProps) {
  if (changes.length === 0) {
    return <aside className="changes empty-note">Working tree clean</aside>;
  }
  return (
    <aside className="changes">
      <ChangeGroup title="Unstaged" staged={false} changes={changes.filter((c) => c.unstaged)} {...rest} />
      <ChangeGroup title="Staged" staged changes={changes.filter((c) => c.staged)} {...rest} />
    </aside>
  );
}
