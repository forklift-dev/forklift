import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { automaticChoice, chosenLines, parseConflicts, resolveBlock, type ConflictBlock, type ConflictChoice, type ConflictFile } from '../../../shared/conflicts';
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

type VisibleChoice = 'ours' | 'theirs' | 'both' | 'theirs-ours';
type ConflictSideName = 'ours' | 'base' | 'theirs';
const CHOICES: VisibleChoice[] = ['ours', 'theirs', 'both', 'theirs-ours'];
const choiceLabel = (choice: VisibleChoice) => ({ ours: t('Take ours'), theirs: t('Take theirs'), both: t('Take both'), 'theirs-ours': t('Theirs, then ours') })[choice];
const choiceTitle = (choice: VisibleChoice) =>
  ({ ours: t('Keep the current branch’s lines'), theirs: t('Keep the incoming lines'), both: t('Ours, then theirs'), 'theirs-ours': t('Incoming lines, then current branch lines') })[choice];

function unusable(version: FileVersion): string | null {
  if (!version.exists) return null;
  if (version.binary) return t('binary');
  if (version.tooLarge) return t('too large to edit here');
  if (version.lossy) return t('not valid UTF-8');
  return null;
}

/** Read-only view of one side of the conflict. */
function SidePane({
  side,
  title,
  version,
  path,
  registerEditor,
  syncScroll,
  onUseSelected,
}: {
  side: ConflictSideName;
  title: string;
  version: FileVersion;
  path: string;
  registerEditor(side: ConflictSideName, editor: monaco.editor.IStandaloneCodeEditor | null): void;
  syncScroll(side: ConflictSideName, scrollTop: number, scrollHeight: number, viewportHeight: number): void;
  onUseSelected(text: string): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const values = useAppState((s) => s.settings.values);
  const [selectedText, setSelectedText] = useState('');
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
    registerEditor(side, editor);
    const scroll = editor.onDidScrollChange(() => syncScroll(side, editor.getScrollTop(), editor.getScrollHeight(), editor.getLayoutInfo().height));
    const selection = editor.onDidChangeCursorSelection(() => {
      const selectedModel = editor.getModel();
      const range = editor.getSelection();
      const text = selectedModel && range ? selectedModel.getValueInRange(range).replace(/(?:\r\n|\r|\n)$/, '') : '';
      setSelectedText(text);
    });
    return () => {
      scroll.dispose();
      selection.dispose();
      registerEditor(side, null);
      editor.setModel(null);
      editor.dispose();
      model.dispose();
    };
  }, [version, path, values, side, registerEditor, syncScroll]);
  return (
    <div className="conflict-pane" data-conflict-side={side}>
      <div className="conflict-pane-title">
        <span>{title}</span>
        {version.exists && version.text !== null && <button type="button" disabled={!selectedText} title={t('Replace the current conflict with these selected lines')} onClick={() => onUseSelected(selectedText)}>{t('Use selected lines')}</button>}
      </div>
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
  const sideEditors = useRef(new Map<ConflictSideName, monaco.editor.IStandaloneCodeEditor>());
  const syncingSides = useRef(false);
  const [blocks, setBlocks] = useState<ConflictBlock[]>([]);
  const [current, setCurrent] = useState(0);
  const [dirty, setDirty] = useState(false);
  // What the file on disk is expected to be at the next save: as loaded, then as last saved.
  const [savedHash, setSavedHash] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const file: ConflictFile | undefined = data;
  const expectedHash = savedHash ?? file?.merged.hash ?? null;
  // Editor options are read when it is created; later changes apply on the next open.
  const valuesRef = useRef(values);
  useLayoutEffect(() => {
    valuesRef.current = values;
  });
  const problem = file ? unusable(file.merged) : null;
  const editable = file?.merged.exists && file.merged.text !== null && !problem;
  const registerSideEditor = useCallback((side: ConflictSideName, editor: monaco.editor.IStandaloneCodeEditor | null) => {
    if (editor) sideEditors.current.set(side, editor);
    else sideEditors.current.delete(side);
  }, []);
  const syncSideScroll = useCallback((source: ConflictSideName, scrollTop: number, scrollHeight: number, viewportHeight: number) => {
    if (syncingSides.current) return;
    const max = Math.max(0, scrollHeight - viewportHeight);
    const progress = max ? scrollTop / max : 0;
    syncingSides.current = true;
    for (const [side, editor] of sideEditors.current) {
      if (side === source) continue;
      const target = editor.getLayoutInfo().height;
      editor.setScrollTop(progress * Math.max(0, editor.getScrollHeight() - target));
    }
    requestAnimationFrame(() => { syncingSides.current = false; });
  }, []);

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
          label: t('{action} (this conflict)', { action: choiceLabel(choice) }),
          contextMenuGroupId: '0_forklift',
          contextMenuOrder: order,
          run: () => {
            const actionModel = editor.getModel();
            const found = actionModel ? parseConflicts(actionModel.getLinesContent().join('\n')) : [];
            const line = editor.getPosition()?.lineNumber ?? 1;
            const block = found[Math.max(0, found.findIndex((item) => item.endLine >= line))] ?? found.at(-1);
            if (block) applyLines(chosenLines(block, choice));
          },
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
  }, [file, editable, path]);

  /** Replaces the conflict around (or after) the cursor with the chosen lines, undoably. */
  function applyLines(lines: string[], index?: number) {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const found = parseConflicts(model.getLinesContent().join('\n'));
    const line = editor.getPosition()?.lineNumber ?? 1;
    const block = found[index ?? Math.max(0, found.findIndex((b) => b.endLine >= line))] ?? found.at(-1);
    if (!block) return;
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

  /** Replaces the current conflict around the cursor with the chosen side or selected lines. */
  function applyChoice(choice: ConflictChoice, index?: number) {
    const model = editorRef.current?.getModel();
    const found = model ? parseConflicts(model.getLinesContent().join('\n')) : [];
    const line = editorRef.current?.getPosition()?.lineNumber ?? 1;
    const block = found[index ?? Math.max(0, found.findIndex((item) => item.endLine >= line))] ?? found.at(-1);
    if (block) applyLines(chosenLines(block, choice), index);
  }

  const autoCount = blocks.filter((block) => automaticChoice(block) !== null).length;
  const autoResolve = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !autoCount) return;
    let text = model.getValue();
    for (const block of [...parseConflicts(model.getLinesContent().join('\n'))].reverse()) {
      const choice = automaticChoice(block);
      if (choice) text = resolveBlock(text, block, choice);
    }
    editor.pushUndoStop();
    editor.executeEdits('forklift.conflict.auto', [{ range: model.getFullModelRange(), text }]);
    editor.pushUndoStop();
    editor.focus();
  };

  const useSelectedLines = (text: string) => {
    const model = editorRef.current?.getModel();
    if (!model || !text) return;
    const lines = text.split(/\r\n|\r|\n/);
    if (!lines.at(-1)) lines.pop();
    applyLines(lines, current);
    editorRef.current?.focus();
  };

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
              <button type="button" disabled={!autoCount} title={t('Apply safe choices based on the common ancestor and whitespace')} onClick={autoResolve}>
                {t('Auto-resolve simple ({count})', { count: autoCount })}
              </button>
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
            <SidePane side="ours" title={labels ? t('Ours — {label}', { label: labels.oursLabel }) : t('Ours')} version={file.ours} path={path} registerEditor={registerSideEditor} syncScroll={syncSideScroll} onUseSelected={useSelectedLines} />
            <SidePane side="base" title={t('Base')} version={file.base} path={path} registerEditor={registerSideEditor} syncScroll={syncSideScroll} onUseSelected={useSelectedLines} />
            <SidePane side="theirs" title={labels ? t('Theirs — {label}', { label: labels.theirsLabel }) : t('Theirs')} version={file.theirs} path={path} registerEditor={registerSideEditor} syncScroll={syncSideScroll} onUseSelected={useSelectedLines} />
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
