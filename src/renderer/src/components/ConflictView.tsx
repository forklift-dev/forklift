import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { chosenLines, parseConflicts, type ConflictBlock, type ConflictChoice, type ConflictFile } from '../../../shared/conflicts';
import type { FileVersion } from '../../../shared/diff';
import { t } from '../../../shared/i18n';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { CODE_FONT, languageForPath, monaco } from '../monaco/setup';
import { useAppState } from '../state';
import { useCommand } from '../useCommand';
import { useConfirm } from './ConfirmDialog';

interface ConflictViewProps {
  repo: string;
  path: string;
  run: RunAction;
  runInBackground: RunAction;
  onClose(): void;
}

type VisibleChoice = 'ours' | 'theirs' | 'both';
const CHOICES: VisibleChoice[] = ['ours', 'theirs', 'both'];
const choiceLabel = (choice: VisibleChoice) => ({ ours: t('Take ours'), theirs: t('Take theirs'), both: t('Take both') })[choice];
const choiceTitle = (choice: VisibleChoice) =>
  ({ ours: t('Keep the current branch’s lines'), theirs: t('Keep the incoming lines'), both: t('Ours, then theirs') })[choice];

function unusable(version: FileVersion): string | null {
  if (!version.exists) return null;
  if (version.binary) return t('binary');
  if (version.tooLarge) return t('too large to edit here');
  if (version.lossy) return t('not valid UTF-8');
  return null;
}

/** Read-only view of one side of the conflict. */
function SidePane({ title, version, path }: { title: string; version: FileVersion; path: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const values = useAppState((s) => s.settings.values);
  useEffect(() => {
    if (!version.exists || version.text === null) return;
    const model = monaco.editor.createModel(version.text, languageForPath(path));
    const editor = monaco.editor.create(ref.current!, {
      model,
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: values['editor.fontFamily'] || CODE_FONT,
      fontSize: values['editor.fontSize'],
      lineNumbersMinChars: 3,
    });
    return () => {
      editor.setModel(null);
      editor.dispose();
      model.dispose();
    };
  }, [version, path, values]);
  return (
    <div className="conflict-pane">
      <div className="conflict-pane-title">{title}</div>
      {version.exists && version.text !== null ? (
        <div className="conflict-editor" ref={ref} />
      ) : (
        <div className="diff-message">{version.exists ? t('This version is {problem}', { problem: unusable(version) ?? '' }) : t('Deleted on this side')}</div>
      )}
    </div>
  );
}

/**
 * Three-pane conflict editor: ours and theirs for reference, the result (the file with git's conflict
 * markers) editable below. Each conflict can be resolved with one click or by editing; saving can mark
 * the file resolved (stages it).
 */
export function ConflictView({ repo, path, run, runInBackground, onClose }: ConflictViewProps) {
  const { data, error } = useCommand('conflict:file', [repo, path]);
  const values = useAppState((s) => s.settings.values);
  const resultRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [blocks, setBlocks] = useState<ConflictBlock[]>([]);
  const [current, setCurrent] = useState(0);
  const [dirty, setDirty] = useState(false);
  // What the file on disk is expected to be at the next save: as loaded, then as last saved.
  const [savedHash, setSavedHash] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const oursActionLabel = t('{action} (this conflict)', { action: choiceLabel('ours') });
  const theirsActionLabel = t('{action} (this conflict)', { action: choiceLabel('theirs') });
  const bothActionLabel = t('{action} (this conflict)', { action: choiceLabel('both') });

  const file: ConflictFile | undefined = data;
  const expectedHash = savedHash ?? file?.merged.hash ?? null;
  // Editor options are read when it is created; later changes apply on the next open.
  const valuesRef = useRef(values);
  useLayoutEffect(() => {
    valuesRef.current = values;
  });
  const problem = file ? unusable(file.merged) : null;
  const editable = file?.merged.exists && file.merged.text !== null && !problem;

  // The result editor: created once the file is loaded; conflict blocks are re-read on every edit.
  useEffect(() => {
    if (!file || !editable) return;
    const options = valuesRef.current;
    const model = monaco.editor.createModel(file.merged.text!, languageForPath(path));
    const editor = monaco.editor.create(resultRef.current!, {
      model,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      glyphMargin: false,
      lineNumbersMinChars: 3,
      fontFamily: options['editor.fontFamily'] || CODE_FONT,
      fontSize: options['editor.fontSize'],
      tabSize: options['editor.tabSize'],
    });
    editorRef.current = editor;
    const decorations = editor.createDecorationsCollection();
    const initial = model.getAlternativeVersionId();

    const update = () => {
      const found = parseConflicts(model.getLinesContent().join('\n'));
      setBlocks(found);
      const lineDecoration = (from: number, to: number, className: string) =>
        from <= to ? [{ range: new monaco.Range(from, 1, to, 1), options: { isWholeLine: true, className, overviewRuler: { color: { id: 'editorOverviewRuler.warningForeground' }, position: monaco.editor.OverviewRulerLane.Full } } }] : [];
      decorations.set(
        found.flatMap((block) => {
          const oursEnd = (block.baseLine || block.separatorLine) - 1;
          return [
            ...lineDecoration(block.startLine, block.startLine, 'conflict-marker'),
            ...lineDecoration(block.startLine + 1, oursEnd, 'conflict-ours'),
            ...(block.baseLine ? [...lineDecoration(block.baseLine, block.baseLine, 'conflict-marker'), ...lineDecoration(block.baseLine + 1, block.separatorLine - 1, 'conflict-base')] : []),
            ...lineDecoration(block.separatorLine, block.separatorLine, 'conflict-marker'),
            ...lineDecoration(block.separatorLine + 1, block.endLine - 1, 'conflict-theirs'),
            ...lineDecoration(block.endLine, block.endLine, 'conflict-marker'),
          ];
        }),
      );
    };
    const followCursor = () => {
      const line = editor.getPosition()?.lineNumber ?? 1;
      const found = parseConflicts(model.getLinesContent().join('\n'));
      const index = found.findIndex((block) => block.endLine >= line);
      setCurrent(index < 0 ? Math.max(0, found.length - 1) : index);
    };
    update();
    const disposables = [
      model.onDidChangeContent(() => {
        update();
        setDirty(model.getAlternativeVersionId() !== initial);
      }),
      editor.onDidChangeCursorPosition(followCursor),
      ...CHOICES.map((choice, order) =>
        editor.addAction({
          id: `forklift.conflict.${choice}`,
          label: choice === 'ours' ? oursActionLabel : choice === 'theirs' ? theirsActionLabel : bothActionLabel,
          contextMenuGroupId: '0_forklift',
          contextMenuOrder: order,
          run: () => applyChoice(choice),
        }),
      ),
    ];
    const first = parseConflicts(model.getValue())[0];
    if (first) editor.revealLineInCenter(first.startLine);
    return () => {
      for (const disposable of disposables) disposable.dispose();
      editor.setModel(null);
      editor.dispose();
      model.dispose();
      editorRef.current = null;
    };
  }, [file, editable, path, oursActionLabel, theirsActionLabel, bothActionLabel]);

  /** Replaces the conflict around (or after) the cursor with the chosen lines, undoably. */
  function applyChoice(choice: ConflictChoice, index?: number) {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const found = parseConflicts(model.getLinesContent().join('\n'));
    const line = editor.getPosition()?.lineNumber ?? 1;
    const block = found[index ?? Math.max(0, found.findIndex((b) => b.endLine >= line))] ?? found.at(-1);
    if (!block) return;
    const lines = chosenLines(block, choice);
    const eol = model.getEOL();
    let range: monaco.Range;
    let text = lines.join(eol);
    if (lines.length) range = new monaco.Range(block.startLine, 1, block.endLine, model.getLineMaxColumn(block.endLine));
    else if (block.endLine < model.getLineCount()) range = new monaco.Range(block.startLine, 1, block.endLine + 1, 1);
    else if (block.startLine > 1) range = new monaco.Range(block.startLine - 1, model.getLineMaxColumn(block.startLine - 1), block.endLine, model.getLineMaxColumn(block.endLine));
    else {
      range = model.getFullModelRange();
      text = '';
    }
    editor.pushUndoStop();
    editor.executeEdits('forklift.conflict', [{ range, text }]);
    editor.pushUndoStop();
    const next = parseConflicts(model.getLinesContent().join('\n'))[0];
    if (next) {
      editor.setPosition({ lineNumber: next.startLine, column: 1 });
      editor.revealLineInCenter(next.startLine);
    }
    editor.focus();
  }

  const goTo = (index: number) => {
    const block = blocks[index];
    const editor = editorRef.current;
    if (!block || !editor) return;
    editor.setPosition({ lineNumber: block.startLine, column: 1 });
    editor.revealLineInCenter(block.startLine);
    editor.focus();
  };

  const save = async (markResolved: boolean) => {
    const text = editorRef.current?.getModel()?.getValue();
    if (text === undefined) return;
    if (markResolved && blocks.length) {
      const ok = await confirm({
        title: t('{count} conflicts are not resolved', { count: blocks.length }),
        detail: t('The conflict markers will be committed as they are. Mark the file resolved anyway?'),
        confirmLabel: t('Mark resolved'),
        danger: true,
      });
      if (!ok) return;
    }
    const saved = await run(() => invoke('conflict:save', repo, path, text, expectedHash, markResolved));
    if (!saved) return;
    if (markResolved) return onClose();
    setDirty(false);
    // The next save compares against what was just written.
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    setSavedHash([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''));
  };

  const take = async (side: 'ours' | 'theirs') => {
    if (
      dirty &&
      !(await confirm({
        title: t('Discard your edits?'),
        detail: side === 'ours' ? t('The whole file is replaced by the current branch’s version.') : t('The whole file is replaced by the incoming version.'),
        confirmLabel: t('Replace'),
        danger: true,
      }))
    )
      return;
    if (await run(() => invoke('conflict:take', repo, path, side))) onClose();
  };

  const close = async () => {
    if (dirty && !(await confirm({ title: t('Close without saving?'), detail: t('Your edits to the result are lost.'), confirmLabel: t('Close'), danger: true }))) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) void close();
      if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void save(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const labels = blocks[0] ?? null;
  return (
    <section className="conflict-view" aria-label={t('Conflicts in {path}', { path })}>
      <header className="diff-header">
        <div className="diff-title" title={path}>
          <strong>{path}</strong>
          <span className="diff-subtitle">
            {editable ? (blocks.length ? t('Conflict {current} of {count}', { current: Math.min(current + 1, blocks.length), count: blocks.length }) : t('No conflicts left')) : t('Conflict')}
          </span>
          {dirty && <span className="dirty-mark" title={t('Not saved')}>●</span>}
        </div>
        <div className="diff-toolbar">
          {editable && (
            <>
              <button type="button" onClick={() => goTo(Math.max(0, current - 1))} disabled={blocks.length === 0} title={t('Previous conflict')}>
                ↑
              </button>
              <button type="button" onClick={() => goTo(Math.min(blocks.length - 1, current + 1))} disabled={blocks.length === 0} title={t('Next conflict')}>
                ↓
              </button>
              {CHOICES.map((choice) => (
                <button key={choice} type="button" disabled={blocks.length === 0} title={choiceTitle(choice)} onClick={() => applyChoice(choice, current)}>
                  {choiceLabel(choice)}
                </button>
              ))}
            </>
          )}
          <button type="button" onClick={() => void take('ours')} title={t('Resolve with the current branch’s whole file')}>
            {t('Use our file')}
          </button>
          <button type="button" onClick={() => void take('theirs')} title={t('Resolve with the incoming whole file')}>
            {t('Use their file')}
          </button>
          <button type="button" onClick={() => void runInBackground(() => invoke('file:externalMerge', repo, path))} title={t('Resolve in the external merge tool')}>
            {t('External')}
          </button>
          {editable && (
            <>
              <button type="button" onClick={() => void save(false)} disabled={!dirty} title={t('Save (Ctrl+S)')}>
                {t('Save')}
              </button>
              <button type="button" className="primary" onClick={() => void save(true)}>
                {t('Save and mark resolved')}
              </button>
            </>
          )}
          <button type="button" onClick={() => void close()} title={t('Close (Esc)')} aria-label={t('Close conflict editor')}>
            ✕
          </button>
        </div>
      </header>
      {error && <div className="diff-message error">{error}</div>}
      {!file && !error && <div className="diff-message">{t('Loading…')}</div>}
      {file && (
        <div className="conflict-body">
          <div className="conflict-sides">
            <SidePane title={labels ? t('Ours — {label}', { label: labels.oursLabel }) : t('Ours')} version={file.ours} path={path} />
            <SidePane title={labels ? t('Theirs — {label}', { label: labels.theirsLabel }) : t('Theirs')} version={file.theirs} path={path} />
          </div>
          <div className="conflict-pane result">
            <div className="conflict-pane-title">{editable ? t('Result — edit freely; colored blocks are conflicts') : t('Result')}</div>
            {editable ? (
              <div className="conflict-editor" ref={resultRef} />
            ) : (
              <div className="diff-message">
                {file.merged.exists ? t('The file is {problem}: choose a whole side or use the external tool.', { problem: problem ?? '' }) : t('The file was deleted in the working tree: choose a side.')}
              </div>
            )}
          </div>
        </div>
      )}
      {dialog}
    </section>
  );
}
