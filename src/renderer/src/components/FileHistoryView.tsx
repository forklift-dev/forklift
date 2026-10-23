import { useEffect, useRef, useState } from 'react';
import { UNCOMMITTED, type BlameResult, type FileHistoryEntry } from '../../../shared/fileHistory';
import { CODE_FONT, languageForPath, monaco } from '../monaco/setup';
import { useAppState } from '../state';
import { useCommand } from '../useCommand';
import { DiffView } from './DiffView';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const STATUS_LABEL: Record<FileHistoryEntry['status'], string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', typechange: 'T' };

interface FileHistoryViewProps {
  repo: string;
  path: string;
  mode: 'history' | 'blame';
  onMode(mode: 'history' | 'blame'): void;
  /** Shows a commit in the graph (and closes this view). */
  onShowCommit(sha: string): void;
  onClose(): void;
}

/** One file's story: the commits that changed it (with its diff in each), or who wrote each line (blame). */
export function FileHistoryView({ repo, path, mode, onMode, onShowCommit, onClose }: FileHistoryViewProps) {
  // A past revision is blamed under the name the file had then (it may have been renamed since).
  const [blameAt, setBlameAt] = useState<{ rev: string; path: string } | null>(null);
  const blameRev = blameAt?.rev ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && !event.defaultPrevented && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section className="file-history" aria-label={`History of ${path}`}>
      <header className="diff-header">
        <div className="diff-title" title={path}>
          <strong>{path}</strong>
          <span className="diff-subtitle">{mode === 'blame' ? (blameRev ? `blame at ${blameRev.slice(0, 7)}` : 'blame of the working tree') : 'file history'}</span>
        </div>
        <div className="diff-toolbar">
          <div className="scope-switch" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={mode === 'history'} onClick={() => onMode('history')}>
              History
            </button>
            <button type="button" role="tab" aria-selected={mode === 'blame'} onClick={() => onMode('blame')}>
              Blame
            </button>
          </div>
          <button type="button" onClick={onClose} aria-label="Close file history" title="Close (Esc)">
            ✕
          </button>
        </div>
      </header>
      {mode === 'history' ? (
        <HistoryList repo={repo} path={path} onBlameAt={(entry) => (setBlameAt({ rev: entry.sha, path: entry.path }), onMode('blame'))} onShowCommit={onShowCommit} />
      ) : (
        <BlameView key={blameRev ?? 'worktree'} repo={repo} path={blameAt?.path ?? path} rev={blameRev} onShowCommit={onShowCommit} onWorkingTree={blameAt ? () => setBlameAt(null) : undefined} />
      )}
    </section>
  );
}

function HistoryList({ repo, path, onBlameAt, onShowCommit }: { repo: string; path: string; onBlameAt(entry: FileHistoryEntry): void; onShowCommit(sha: string): void }) {
  const { data, error } = useCommand('file:history', [repo, path]);
  const [selected, setSelected] = useState<FileHistoryEntry | null>(null);
  const shown = selected ?? data?.[0] ?? null;
  if (error) return <div className="diff-message error">{error}</div>;
  if (!data) return <div className="diff-message">Loading…</div>;
  if (data.length === 0) return <div className="diff-message">No commits changed this file</div>;
  return (
    <div className="file-history-body">
      <ol className="file-history-list" aria-label="Commits that changed the file">
        {data.map((entry) => (
          <li key={entry.sha}>
            <button type="button" className={`history-entry${entry.sha === shown?.sha ? ' selected' : ''}`} onClick={() => setSelected(entry)} data-sha={entry.sha}>
              <span className={`kind kind-${entry.status}`}>{STATUS_LABEL[entry.status]}</span>
              <span className="history-entry-text">
                <span className="history-subject">{entry.subject}</span>
                <span className="history-meta">
                  {entry.authorName} · {dateFormat.format(entry.time * 1000)} · {entry.sha.slice(0, 7)}
                  {entry.oldPath && ` · renamed from ${entry.oldPath}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {shown && (
        <DiffView
          key={shown.sha}
          repo={repo}
          target={{ kind: 'commit', sha: shown.sha, path: shown.path, ...(shown.oldPath && { oldPath: shown.oldPath }) }}
          title={shown.subject}
          subtitle={shown.sha.slice(0, 7)}
          onClose={() => setSelected(null)}
          actions={
            <>
              <button type="button" onClick={() => onBlameAt(shown)} disabled={shown.status === 'deleted'}>
                Blame here
              </button>
              <button type="button" onClick={() => onShowCommit(shown.sha)}>
                Show commit
              </button>
            </>
          }
        />
      )}
    </div>
  );
}

/** Blame in a read-only editor: commit, author and date in the line number gutter, age as a color band. */
function BlameView({ repo, path, rev, onShowCommit, onWorkingTree }: { repo: string; path: string; rev: string | null; onShowCommit(sha: string): void; onWorkingTree?(): void }) {
  const { data, error } = useCommand('file:blame', [repo, path, rev]);
  const values = useAppState((s) => s.settings.values);
  const ref = useRef<HTMLDivElement>(null);
  const showCommitRef = useRef(onShowCommit);
  useEffect(() => {
    showCommitRef.current = onShowCommit;
  });

  useEffect(() => {
    if (!data) return;
    const blame: BlameResult = data;
    const lineSha: string[] = [];
    const firstLine = new Set<number>();
    for (const hunk of blame.hunks) {
      firstLine.add(hunk.start);
      for (let i = 0; i < hunk.count; i++) lineSha[hunk.start + i] = hunk.sha;
    }
    const times = Object.entries(blame.commits).filter(([sha]) => sha !== UNCOMMITTED).map(([, c]) => c.time);
    const oldest = Math.min(...times);
    const newest = Math.max(...times);
    const age = (sha: string) => (sha === UNCOMMITTED || newest === oldest ? 9 : Math.round(((blame.commits[sha]!.time - oldest) / (newest - oldest)) * 9));
    const label = (line: number) => {
      const sha = lineSha[line];
      if (!sha || !firstLine.has(line)) return '';
      if (sha === UNCOMMITTED) return 'Not committed yet';
      const commit = blame.commits[sha]!;
      return `${sha.slice(0, 7)} ${commit.authorName.slice(0, 14).padEnd(14)} ${dateFormat.format(commit.time * 1000)}`;
    };
    const model = monaco.editor.createModel(blame.text, languageForPath(path));
    const editor = monaco.editor.create(ref.current!, {
      model,
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: label,
      lineNumbersMinChars: 40,
      fontFamily: values['editor.fontFamily'] || CODE_FONT,
      fontSize: values['editor.fontSize'],
    });
    editor.createDecorationsCollection(
      blame.hunks.map((hunk) => {
        const commit = blame.commits[hunk.sha];
        return {
          range: new monaco.Range(hunk.start, 1, hunk.start + hunk.count - 1, 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: `blame-age blame-age-${age(hunk.sha)}`,
            ...(commit && hunk.sha !== UNCOMMITTED && { hoverMessage: { value: `**${commit.summary}**\n\n${commit.authorName} <${commit.authorEmail}> · ${hunk.sha.slice(0, 10)}` } }),
          },
        };
      }),
    );
    const click = editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return;
      const sha = lineSha[event.target.position?.lineNumber ?? 0];
      if (sha && sha !== UNCOMMITTED) showCommitRef.current(sha);
    });
    return () => {
      click.dispose();
      editor.setModel(null);
      editor.dispose();
      model.dispose();
    };
  }, [data, path, values]);

  if (error) return <div className="diff-message error">{error}</div>;
  return (
    <div className="blame-view">
      {onWorkingTree && (
        <div className="diff-hint">
          Blame at a past commit.{' '}
          <button type="button" className="link-button" onClick={onWorkingTree}>
            Back to the working tree
          </button>
        </div>
      )}
      {!data && <div className="diff-message">Loading…</div>}
      <div className="blame-editor" ref={ref} hidden={!data} />
    </div>
  );
}
