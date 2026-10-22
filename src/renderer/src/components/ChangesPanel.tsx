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
  onStage(paths: string[]): void;
  onUnstage(paths: string[]): void;
  onDiscard(paths: string[]): void;
  onOpenInEditor(path: string): void;
  onExternalDiff(path: string, staged: boolean): void;
  onExternalMerge(path: string): void;
}

function IconButton({ icon, label, onClick, danger }: { icon: string; label: string; onClick(): void; danger?: boolean }) {
  return (
    <button type="button" className={`icon-button${danger ? ' danger-text' : ''}`} title={label} aria-label={label} onClick={onClick}>
      <span className={`codicon codicon-${icon}`} />
    </button>
  );
}

interface ChangeGroupProps extends FileActions {
  title: string;
  staged: boolean;
  changes: FileChange[];
  selected: { path: string; staged: boolean } | null;
}

function ChangeGroup({ title, staged, changes, selected, ...actions }: ChangeGroupProps) {
  if (changes.length === 0) return null;
  const paths = changes.map((c) => c.path);
  const discardable = changes.filter((c) => c.kind !== 'conflicted').map((c) => c.path);
  return (
    <div className="change-group">
      <h3 className="group-header">
        <span>
          {title} <span className="count">{changes.length}</span>
        </span>
        <span className="group-actions">
          {staged ? (
            <IconButton icon="remove" label="Unstage all" onClick={() => actions.onUnstage(paths)} />
          ) : (
            <>
              {discardable.length > 0 && <IconButton icon="discard" label="Discard all" danger onClick={() => actions.onDiscard(discardable)} />}
              <IconButton icon="add" label="Stage all" onClick={() => actions.onStage(paths)} />
            </>
          )}
        </span>
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
                onClick={() => actions.onShowDiff(change, staged)}
              >
                <span className={`kind kind-${change.kind}`}>{KIND_LABEL[change.kind]}</span>
                {change.path}
              </button>
              <span className="row-actions">
                {change.kind !== 'deleted' && <IconButton icon="go-to-file" label="Open in editor" onClick={() => actions.onOpenInEditor(change.path)} />}
                {conflicted ? (
                  <IconButton icon="git-merge" label="Resolve in external merge tool" onClick={() => actions.onExternalMerge(change.path)} />
                ) : (
                  change.kind !== 'untracked' && (
                    <IconButton icon="diff" label="Open in external diff tool" onClick={() => actions.onExternalDiff(change.path, staged)} />
                  )
                )}
                {!staged && !conflicted && <IconButton icon="discard" label="Discard changes" danger onClick={() => actions.onDiscard([change.path])} />}
                {staged ? (
                  <IconButton icon="remove" label="Unstage" onClick={() => actions.onUnstage([change.path])} />
                ) : (
                  <IconButton icon="add" label={conflicted ? 'Mark resolved (stage)' : 'Stage'} onClick={() => actions.onStage([change.path])} />
                )}
              </span>
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
    return <div className="changes empty-note">Working tree clean</div>;
  }
  return (
    <div className="changes">
      <ChangeGroup title="Unstaged" staged={false} changes={changes.filter((c) => c.unstaged)} {...rest} />
      <ChangeGroup title="Staged" staged changes={changes.filter((c) => c.staged)} {...rest} />
    </div>
  );
}
