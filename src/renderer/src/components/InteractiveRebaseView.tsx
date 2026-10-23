import { useState } from 'react';
import { planProblem, type RebaseAction, type RebaseCommit, type RebaseStep } from '../../../shared/rebase';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { useCommand } from '../useCommand';

const ACTIONS: Array<{ value: RebaseAction; label: string; title: string }> = [
  { value: 'pick', label: 'Pick', title: 'Keep the commit' },
  { value: 'reword', label: 'Reword', title: 'Keep it with a new message' },
  { value: 'squash', label: 'Squash', title: 'Combine into the commit below, messages joined' },
  { value: 'fixup', label: 'Fixup', title: 'Combine into the commit below, keeping its message' },
  { value: 'drop', label: 'Drop', title: 'Leave the commit out' },
];

interface Row extends RebaseCommit {
  action: RebaseAction;
  /** Edited message (reword, or the first commit of a squash group); undefined: not edited. */
  edited?: string;
}

interface InteractiveRebaseViewProps {
  repo: string;
  /** The commit the edited commits come after (it stays as it is). */
  base: string;
  branch: string;
  run: RunAction;
  onClose(): void;
}

/**
 * Edits an interactive rebase: commits newest first as in the graph, an action per commit, reordering by
 * drag and drop or the arrows, messages for reworded and squashed commits. Git runs it from the plan.
 */
export function InteractiveRebaseView(props: InteractiveRebaseViewProps) {
  const { data, error } = useCommand('rebase:plan', [props.repo, props.base]);
  if (error) {
    return (
      <section className="rebase-view">
        <Header {...props} problem={null} onStart={null} />
        <div className="diff-message error">{error}</div>
      </section>
    );
  }
  if (!data) return <div className="diff-message">Loading…</div>;
  // Remount per plan: the rows start from it.
  return <Editor key={data.map((c) => c.sha).join()} {...props} plan={data} />;
}

function Header({ branch, base, onClose, problem, onStart }: InteractiveRebaseViewProps & { problem: string | null; onStart: (() => void) | null }) {
  return (
    <header className="diff-header">
      <div className="diff-title">
        <strong>Interactive rebase of {branch}</strong>
        <span className="diff-subtitle">onto {base.slice(0, 7)}</span>
      </div>
      <div className="diff-toolbar">
        {problem && <span className="setting-error">{problem}</span>}
        {onStart && (
          <button type="button" className="primary" disabled={Boolean(problem)} onClick={onStart}>
            Start rebase
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Cancel interactive rebase">
          Cancel
        </button>
      </div>
    </header>
  );
}

function Editor(props: InteractiveRebaseViewProps & { plan: RebaseCommit[] }) {
  // Newest first, as the graph shows them; git's plan is the reverse.
  const [rows, setRows] = useState<Row[]>(() => [...props.plan].reverse().map((commit) => ({ ...commit, action: 'pick' })));
  const [dragging, setDragging] = useState<number | null>(null);

  const update = (index: number, change: Partial<Row>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const move = (from: number, to: number) =>
    setRows((current) => {
      if (to < 0 || to >= current.length || from === to) return current;
      const next = [...current];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row!);
      return next;
    });

  const oldestFirst = [...rows].reverse();
  /** Rows (newest-first indices) squashed into the row at `index`, i.e. directly above it in the list. */
  const squashedInto = (index: number) => {
    const result: Row[] = [];
    for (let i = index - 1; i >= 0; i--) {
      const action = rows[i]!.action;
      if (action === 'drop') continue;
      if (action !== 'squash' && action !== 'fixup') break;
      if (action === 'squash') result.push(rows[i]!);
    }
    return result;
  };
  const defaultMessage = (index: number) => [rows[index]!.message, ...squashedInto(index).map((row) => row.message)].join('\n\n');

  const steps: RebaseStep[] = oldestFirst.map((row) => {
    const index = rows.indexOf(row);
    const needsMessage = row.action === 'reword' || (row.action === 'pick' && squashedInto(index).length > 0);
    const message = needsMessage ? (row.edited ?? (row.action === 'reword' ? row.message : undefined)) : undefined;
    return { sha: row.sha, action: row.action, ...(message !== undefined && { message }) };
  });
  const problem = planProblem(steps);

  const start = async () => {
    if (await props.run(() => invoke('rebase:interactive', props.repo, props.base, steps))) props.onClose();
  };

  return (
    <section className="rebase-view" aria-label="Interactive rebase">
      <Header {...props} problem={problem} onStart={() => void start()} />
      <p className="rebase-hint">Newest commit on top. Squash and fixup combine a commit into the one below it. Drag rows or use the arrows to reorder.</p>
      <ol className="rebase-list">
        {rows.map((row, index) => {
          const group = squashedInto(index);
          const showMessage = row.action === 'reword' || (row.action === 'pick' && group.length > 0);
          return (
            <li
              key={row.sha}
              className={`rebase-row action-${row.action}${dragging === index ? ' dragging' : ''}`}
              data-sha={row.sha}
              draggable
              onDragStart={(event) => {
                setDragging(index);
                event.dataTransfer.setData('application/x-forklift-rebase', String(index));
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData('application/x-forklift-rebase'));
                if (Number.isInteger(from)) move(from, index);
                setDragging(null);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <div className="rebase-line">
                <span className="codicon codicon-gripper drag-handle" aria-hidden="true" />
                <select aria-label={`Action for ${row.subject}`} value={row.action} onChange={(event) => update(index, { action: event.target.value as RebaseAction, edited: undefined })}>
                  {ACTIONS.map((action) => (
                    <option key={action.value} value={action.value} title={action.title}>
                      {action.label}
                    </option>
                  ))}
                </select>
                <span className="hash">{row.sha.slice(0, 7)}</span>
                <span className="rebase-subject">{row.subject}</span>
                <button type="button" className="icon-button" aria-label="Move up (later)" disabled={index === 0} onClick={() => move(index, index - 1)}>
                  <span className="codicon codicon-arrow-up" aria-hidden="true" />
                </button>
                <button type="button" className="icon-button" aria-label="Move down (earlier)" disabled={index === rows.length - 1} onClick={() => move(index, index + 1)}>
                  <span className="codicon codicon-arrow-down" aria-hidden="true" />
                </button>
              </div>
              {showMessage && (
                <label className="rebase-message">
                  {group.length ? `Message of the combined commit (${group.length + 1} commits)` : 'New message'}
                  <textarea rows={Math.min(8, Math.max(3, (row.edited ?? defaultMessage(index)).split('\n').length))} value={row.edited ?? (group.length ? defaultMessage(index) : row.message)} onChange={(event) => update(index, { edited: event.target.value })} />
                </label>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
