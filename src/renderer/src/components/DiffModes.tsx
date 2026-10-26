import { useEffect, useRef } from 'react';
import type { FileDiff } from '../../../shared/diff';
import { t } from '../../../shared/i18n';
import { changeLines, hunkHeader, type LineAction, type LineChange } from '../../../shared/staging';
import { anchorLine, selectedLines } from '../monaco/lineActions';
import { languageForPath, monaco } from '../monaco/setup';

const CONTEXT = 3;
const actionLabel = (action: LineAction) => ({ stage: t('Stage hunk'), unstage: t('Unstage hunk'), discard: t('Discard hunk') })[action];

export interface LineSelection {
  original: Set<number>;
  modified: Set<number>;
}

const lines = (text: string | null) => (text ?? '').split(/\r?\n/);
interface HunkViewProps {
  data: FileDiff;
  changes: LineChange[];
  /** Hunk buttons; empty when nothing can be done (a commit diff, or lines are blocked). */
  actions: LineAction[];
  onAction(action: LineAction, change: LineChange): void;
  selection: LineSelection;
  onSelection(selection: LineSelection): void;
}

/** Only the changed fragments, with git-style headers, 3 lines of context and a button per action. Click lines to select them. */
export function HunkView({ data, changes, actions, onAction, selection, onSelection }: HunkViewProps) {
  const original = lines(data.original.text);
  const modified = lines(data.modified.text);
  const toggle = (side: 'original' | 'modified', line: number) => {
    const next = { original: new Set(selection.original), modified: new Set(selection.modified) };
    if (next[side].has(line)) next[side].delete(line);
    else next[side].add(line);
    onSelection(next);
  };
  if (changes.length === 0) return <div className="diff-message">{t('No changes')}</div>;
  return (
    <div className="hunk-view" role="list" aria-label={t('Changed fragments')}>
      {changes.map((change) => {
        const changed = changeLines(change);
        const before = Math.max(1, (change.modifiedEndLineNumber === 0 ? change.modifiedStartLineNumber + 1 : change.modifiedStartLineNumber) - CONTEXT);
        const afterStart = (change.modifiedEndLineNumber === 0 ? change.modifiedStartLineNumber : change.modifiedEndLineNumber) + 1;
        const firstChanged = change.modifiedEndLineNumber === 0 ? change.modifiedStartLineNumber + 1 : change.modifiedStartLineNumber;
        const contextBefore = Array.from({ length: Math.max(0, firstChanged - before) }, (_, i) => before + i);
        const contextAfter = Array.from({ length: CONTEXT }, (_, i) => afterStart + i).filter((line) => line <= modified.length);
        return (
          <section key={hunkHeader(change)} className="hunk" role="listitem" data-anchor={anchorLine(change)}>
            <header className="hunk-header">
              <code>{hunkHeader(change)}</code>
              <span className="hunk-actions">
                {actions.map((action) => (
                  <button key={action} type="button" className={action === 'discard' ? 'danger-text' : undefined} onClick={() => onAction(action, change)}>
                    {actionLabel(action)}
                  </button>
                ))}
              </span>
            </header>
            <pre className="hunk-lines">
              {contextBefore.map((line) => (
                <div key={`c${line}`} className="hunk-line context">
                  <span className="gutter">{line}</span> {modified[line - 1]}
                </div>
              ))}
              {changed.original.map((line) => (
                <div key={`o${line}`} className={`hunk-line removed${selection.original.has(line) ? ' picked' : ''}`} onClick={() => toggle('original', line)}>
                  <span className="gutter">{line}</span>-{original[line - 1]}
                </div>
              ))}
              {changed.modified.map((line) => (
                <div key={`m${line}`} className={`hunk-line added${selection.modified.has(line) ? ' picked' : ''}`} onClick={() => toggle('modified', line)}>
                  <span className="gutter">{line}</span>+{modified[line - 1]}
                </div>
              ))}
              {contextAfter.map((line) => (
                <div key={`a${line}`} className="hunk-line context">
                  <span className="gutter">{line}</span> {modified[line - 1]}
                </div>
              ))}
            </pre>
          </section>
        );
      })}
    </div>
  );
}

interface FileViewProps {
  data: FileDiff;
  path: string;
  changes: LineChange[];
  fontFamily: string;
  fontSize: number;
  /** Hunk control in the gutter (stage/unstage), when lines can be staged. */
  hunkAction: LineAction | null;
  onAction(action: LineAction, change: LineChange): void;
  /** Lets the toolbar read the selected lines (modified side). */
  editorRef: { current: monaco.editor.IStandaloneCodeEditor | null };
}

/** The whole new version in one editor: added and changed lines highlighted, removals marked between lines. */
export function FileView({ data, path, changes, fontFamily, fontSize, hunkAction, onAction, editorRef }: FileViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const actionRef = useRef({ hunkAction, onAction, changes });
  useEffect(() => {
    actionRef.current = { hunkAction, onAction, changes };
  });

  useEffect(() => {
    const model = monaco.editor.createModel(data.modified.text ?? '', languageForPath(path));
    const editor = monaco.editor.create(ref.current!, {
      model,
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      glyphMargin: true,
      fontFamily,
      fontSize,
    });
    editorRef.current = editor;
    const click = editor.onMouseDown((event) => {
      const { hunkAction: action, onAction: run, changes: current } = actionRef.current;
      if (!action || event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
      const change = current.find((c) => anchorLine(c) === event.target.position?.lineNumber);
      if (change) run(action, change);
    });
    return () => {
      click.dispose();
      editorRef.current = null;
      editor.setModel(null);
      editor.dispose();
      model.dispose();
    };
  }, [data, path, fontFamily, fontSize, editorRef]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const decorations = changes.flatMap((change) => {
      const list: monaco.editor.IModelDeltaDecoration[] = [];
      const removed = change.originalEndLineNumber === 0 ? 0 : change.originalEndLineNumber - change.originalStartLineNumber + 1;
      if (change.modifiedEndLineNumber > 0) {
        list.push({
          range: new monaco.Range(change.modifiedStartLineNumber, 1, change.modifiedEndLineNumber, 1),
          options: { isWholeLine: true, className: removed ? 'file-view-changed' : 'file-view-added', linesDecorationsClassName: removed ? 'file-view-bar changed' : 'file-view-bar added' },
        });
      } else {
        // A pure removal sits between two lines: mark the line after it.
        const line = Math.max(1, change.modifiedStartLineNumber + 1);
        list.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'file-view-removed-above', hoverMessage: { value: t('{count} lines removed here', { count: removed }) } } });
      }
      if (hunkAction) {
        const anchor = anchorLine(change);
        list.push({ range: new monaco.Range(anchor, 1, anchor, 1), options: { glyphMarginClassName: `hunk-glyph codicon ${hunkAction === 'unstage' ? 'codicon-remove' : 'codicon-add'}` } });
      }
      return list;
    });
    const collection = editor.createDecorationsCollection(decorations);
    return () => collection.clear();
  }, [changes, hunkAction, editorRef]);

  return <div className="diff-editor file-view" ref={ref} />;
}

/** Selected modified-side lines of the file view's editor. */
export const fileViewSelection = (editor: monaco.editor.IStandaloneCodeEditor | null): LineSelection => ({
  original: new Set(),
  modified: editor ? selectedLines(editor) : new Set(),
});
