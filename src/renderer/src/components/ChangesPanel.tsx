import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ChangeKind, FileChange } from '../../../shared/state';
import { t } from '../../../shared/i18n';

/** Height of a change row (fixed in CSS, `.change-row`), for drawing only the visible part of long lists. */
const ROW_HEIGHT = 24;
/** Lists up to this long are drawn whole; longer ones (a build folder not ignored, a big checkout) by window. */
const WINDOWED_FROM = 300;
const OVERSCAN = 30;

/** Rows `[start, end)` of a list inside the scrolling `.changes` panel that are on screen (all of a short list). */
function useVisibleRows(list: RefObject<HTMLUListElement | null>, count: number): [number, number] {
  const windowed = count > WINDOWED_FROM;
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, 100)]);
  useEffect(() => {
    const ul = list.current;
    const scroller = ul?.closest('.changes');
    if (!windowed || !ul || !scroller) return;
    const update = () => {
      const top = scroller.scrollTop - (ul.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
      const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
      const end = Math.min(count, Math.ceil((top + scroller.clientHeight) / ROW_HEIGHT) + OVERSCAN);
      setRange((current) => (current[0] === start && current[1] === end ? current : [start, end]));
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [list, count, windowed]);
  return windowed ? [Math.min(range[0], count), Math.min(range[1], count)] : [0, count];
}

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
  /** History and blame of a file that exists in some commit. */
  onFileHistory(path: string): void;
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
  /** Files stored in Git LFS. */
  lfsPaths?: ReadonlySet<string>;
}

function ChangeGroup({ title, staged, changes, selected, lfsPaths, ...actions }: ChangeGroupProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [start, end] = useVisibleRows(listRef, changes.length);
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
            <IconButton icon="remove" label={t('Unstage all')} onClick={() => actions.onUnstage(paths)} />
          ) : (
            <>
              {discardable.length > 0 && <IconButton icon="discard" label={t('Discard all')} danger onClick={() => actions.onDiscard(discardable)} />}
              <IconButton icon="add" label={t('Stage all')} onClick={() => actions.onStage(paths)} />
            </>
          )}
        </span>
      </h3>
      <ul ref={listRef}>
        {start > 0 && <li className="change-spacer" aria-hidden="true" style={{ height: start * ROW_HEIGHT }} />}
        {changes.slice(start, end).map((change) => {
          const label = change.origPath ? `${change.origPath} → ${change.path}` : change.path;
          const conflicted = change.kind === 'conflicted';
          const isSelected = selected?.path === change.path && selected.staged === staged;
          return (
            <li key={change.path} className="change-row">
              <button
                type="button"
                className={`change-item${isSelected ? ' selected' : ''}`}
                title={t('{label}\nShow changes', { label })}
                onClick={() => actions.onShowDiff(change, staged)}
              >
                <span className={`kind kind-${change.kind}`}>{KIND_LABEL[change.kind]}</span>
                {change.submodule && <span className="codicon codicon-file-submodule" aria-label={t('submodule')} title={t('Submodule: staged and discarded as a whole')} />}
                {change.path}
                {lfsPaths?.has(change.path) && <span className="lfs-badge" title={t('Stored in Git LFS')}>LFS</span>}
              </button>
              <span className="row-actions">
                {change.kind !== 'deleted' && <IconButton icon="go-to-file" label={t('Open in editor')} onClick={() => actions.onOpenInEditor(change.path)} />}
                {change.kind !== 'untracked' && change.kind !== 'added' && <IconButton icon="history" label={t('File history and blame')} onClick={() => actions.onFileHistory(change.path)} />}
                {conflicted ? (
                  <IconButton icon="git-merge" label={t('Resolve in external merge tool')} onClick={() => actions.onExternalMerge(change.path)} />
                ) : (
                  change.kind !== 'untracked' && (
                    <IconButton icon="diff" label={t('Open in external diff tool')} onClick={() => actions.onExternalDiff(change.path, staged)} />
                  )
                )}
                {!staged && !conflicted && <IconButton icon="discard" label={t('Discard changes')} danger onClick={() => actions.onDiscard([change.path])} />}
                {staged ? (
                  <IconButton icon="remove" label={t('Unstage')} onClick={() => actions.onUnstage([change.path])} />
                ) : (
                  <IconButton icon="add" label={conflicted ? t('Mark resolved (stage)') : t('Stage')} onClick={() => actions.onStage([change.path])} />
                )}
              </span>
            </li>
          );
        })}
        {end < changes.length && <li className="change-spacer" aria-hidden="true" style={{ height: (changes.length - end) * ROW_HEIGHT }} />}
      </ul>
    </div>
  );
}

interface ChangesPanelProps extends FileActions {
  changes: FileChange[];
  selected: { path: string; staged: boolean } | null;
  lfsPaths?: ReadonlySet<string>;
}

export function ChangesPanel({ changes, ...rest }: ChangesPanelProps) {
  if (changes.length === 0) {
    return <div className="changes empty-note">{t('Working tree clean')}</div>;
  }
  return (
    <div className="changes">
      <ChangeGroup title={t('Unstaged')} staged={false} changes={changes.filter((c) => c.unstaged)} {...rest} />
      <ChangeGroup title={t('Staged')} staged changes={changes.filter((c) => c.staged)} {...rest} />
    </div>
  );
}
