import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DiffTarget, FileDiff, FileVersion } from '../../../shared/diff';
import type { LineAction, LineActionRequest, LineChange } from '../../../shared/staging';
import { anchorLine, changeAt, hunkRequest, selectedLines, selectionRequest, type Side } from '../monaco/lineActions';
import { invoke } from '../api';
import { CODE_FONT, languageForPath, monaco } from '../monaco/setup';
import { useAppState } from '../state';
import { useCommand } from '../useCommand';

interface DiffPrefs {
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  wordWrap: boolean;
  hideUnchanged: boolean;
  contextLines: number;
  fontFamily: string;
  fontSize: number;
  tabSize: number;
}

/** View preferences live in the app settings, so toggles here and in Preferences stay in sync. */
function useDiffPrefs(): DiffPrefs {
  const values = useAppState((s) => s.settings.values);
  return useMemo(
    () => ({
      sideBySide: values['diff.layout'] === 'split',
      ignoreWhitespace: values['diff.ignoreWhitespace'],
      wordWrap: values['diff.wordWrap'],
      hideUnchanged: values['diff.hideUnchanged'],
      contextLines: values['diff.contextLines'],
      fontFamily: values['editor.fontFamily'] || CODE_FONT,
      fontSize: values['editor.fontSize'],
      tabSize: values['editor.tabSize'],
    }),
    [values],
  );
}

const TOGGLES = {
  sideBySide: (on: boolean) => ({ 'diff.layout': on ? 'split' : 'inline' }),
  hideUnchanged: (on: boolean) => ({ 'diff.hideUnchanged': on }),
  ignoreWhitespace: (on: boolean) => ({ 'diff.ignoreWhitespace': on }),
  wordWrap: (on: boolean) => ({ 'diff.wordWrap': on }),
};

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Why the text diff cannot be shown, or null when it can. */
function unavailableReason({ original, modified }: FileDiff): string | null {
  const describe = (v: FileVersion) => (v.exists ? formatSize(v.size) : 'none');
  if (original.binary || modified.binary) return `Binary file (${describe(original)} → ${describe(modified)})`;
  if (original.tooLarge || modified.tooLarge) return `File is too large to show (${describe(original)} → ${describe(modified)})`;
  return null;
}

/** Line staging for working-tree diffs: unstaged (index ↔ working tree) or staged (HEAD ↔ index). */
export interface DiffEditing {
  mode: 'unstaged' | 'staged';
  apply(request: LineActionRequest): Promise<void>;
  confirmDiscard(what: string): Promise<boolean>;
}

const ACTION_LABEL: Record<LineAction, string> = { stage: 'Stage', unstage: 'Unstage', discard: 'Discard' };

interface DiffViewProps {
  /** Tab id (repository root) the target belongs to. */
  repo: string;
  target: DiffTarget;
  title: string;
  subtitle?: string;
  /** Changes when the underlying data may have changed (e.g. after a refresh of the working tree). */
  reloadKey?: unknown;
  actions?: ReactNode;
  editing?: DiffEditing;
  onClose(): void;
}

export function DiffView({ repo, target, title, subtitle, reloadKey, actions, editing, onClose }: DiffViewProps) {
  const { data, error, loading } = useCommand('diff:file', [repo, target], { reloadKey, keepPrevious: true });
  const prefs = useDiffPrefs();
  const [changeCount, setChangeCount] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  const toggle = (key: keyof typeof TOGGLES) => {
    invoke('settings:update', { values: TOGGLES[key](!prefs[key]) }).catch((failure: unknown) => setHint(failure instanceof Error ? failure.message : String(failure)));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && !event.defaultPrevented && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reason = data ? unavailableReason(data) : null;

  // Why lines cannot be staged here; whole-file actions in the panel still work.
  let blocked: string | null = null;
  if (editing && data) {
    if (reason) blocked = 'Use the whole-file actions for this file';
    else if (data.original.lossy || data.modified.lossy) blocked = 'The file is not valid UTF-8; use the whole-file actions';
    else if (!data.modified.exists) blocked = 'The file is deleted; use the whole-file actions';
    else if (prefs.ignoreWhitespace) blocked = 'Turn off "Ignore whitespace" to work with lines';
  }

  /** Builds and sends a line request; `pick` gets the editor's current line changes. */
  const runLineAction = async (action: LineAction, pick: (changes: LineChange[]) => LineActionRequest | null) => {
    setHint(null);
    if (!editing || !data) return;
    if (blocked) return setHint(blocked);
    const changes = editorRef.current?.getLineChanges();
    if (!changes?.length) return setHint('No changes to work with');
    const request = pick(changes);
    if (!request) return setHint('Select changed lines first (left side: removals, right side: additions)');
    if (action === 'discard' && !(await editing.confirmDiscard(`the selected changes in ${target.path}`))) return;
    await editing.apply(request);
  };

  const hunkAction = (action: LineAction, change: LineChange) =>
    runLineAction(action, (changes) => hunkRequest(action, target.path, data!, changes, change));

  const selectionAction = (action: LineAction) =>
    runLineAction(action, (changes) => {
      const editor = editorRef.current!;
      const selected = { original: selectedLines(editor.getOriginalEditor()), modified: selectedLines(editor.getModifiedEditor()) };
      return selectionRequest(action, target.path, data!, changes, selected);
    });

  const lineActions: LineAction[] = editing ? (editing.mode === 'unstaged' ? ['stage', 'discard'] : ['unstage']) : [];

  return (
    <section className="diff-view">
      <header className="diff-header">
        <div className="diff-title" title={title}>
          <strong>{title}</strong>
          {subtitle && <span className="diff-subtitle">{subtitle}</span>}
        </div>
        <div className="diff-toolbar">
          <button type="button" onClick={() => editorRef.current?.goToDiff('previous')} disabled={!changeCount} title="Previous change">
            ↑
          </button>
          <button type="button" onClick={() => editorRef.current?.goToDiff('next')} disabled={!changeCount} title="Next change">
            ↓
          </button>
          <span className="diff-count">{changeCount === null ? '' : `${changeCount} change${changeCount === 1 ? '' : 's'}`}</span>
          <label>
            <input type="checkbox" checked={prefs.sideBySide} onChange={() => toggle('sideBySide')} /> Split
          </label>
          <label>
            <input type="checkbox" checked={prefs.hideUnchanged} onChange={() => toggle('hideUnchanged')} /> Collapse unchanged
          </label>
          <label>
            <input type="checkbox" checked={prefs.ignoreWhitespace} onChange={() => toggle('ignoreWhitespace')} /> Ignore whitespace
          </label>
          <label>
            <input type="checkbox" checked={prefs.wordWrap} onChange={() => toggle('wordWrap')} /> Wrap
          </label>
          {lineActions.map((action) => (
            <button
              key={action}
              type="button"
              className={action === 'discard' ? 'danger-text' : undefined}
              disabled={Boolean(blocked) || !changeCount}
              title={blocked ?? `${ACTION_LABEL[action]} the selected lines (left: removals, right: additions)`}
              onClick={() => void selectionAction(action)}
            >
              {ACTION_LABEL[action]} lines
            </button>
          ))}
          {actions}
          <button type="button" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
      </header>
      {hint && (
        <div className="diff-hint" role="status">
          {hint}
        </div>
      )}
      {error && <div className="diff-message error">{error}</div>}
      {!error && !data && loading && <div className="diff-message">Loading…</div>}
      {data && reason && <div className="diff-message">{reason}</div>}
      {data && !reason && (
        <MonacoDiff
          data={data}
          path={target.path}
          prefs={prefs}
          editorRef={editorRef}
          onChangeCount={setChangeCount}
          hunks={editing && !blocked ? { mode: editing.mode, run: hunkAction, runSelection: selectionAction } : null}
        />
      )}
    </section>
  );
}

interface HunkControls {
  mode: DiffEditing['mode'];
  run(action: LineAction, change: LineChange): void;
  runSelection(action: LineAction): void;
}

interface MonacoDiffProps {
  data: FileDiff;
  path: string;
  prefs: DiffPrefs;
  editorRef: { current: monaco.editor.IStandaloneDiffEditor | null };
  onChangeCount(count: number | null): void;
  /** Null when lines cannot be staged right now; hunk glyphs and menu actions then stay inert. */
  hunks: HunkControls | null;
}

function MonacoDiff({ data, path, prefs, editorRef, onChangeCount, hunks }: MonacoDiffProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hunksRef = useRef(hunks);
  // New models take the current tab width; read through a ref so a model is not recreated when it changes.
  const tabSizeRef = useRef(prefs.tabSize);
  const refreshGlyphsRef = useRef<() => void>(() => {});

  // Editor callbacks are registered once; they read the latest controls through the ref.
  useLayoutEffect(() => {
    hunksRef.current = hunks;
    refreshGlyphsRef.current();
  }, [hunks]);

  // One editor per mounted view; models are swapped when the file or its content changes.
  useEffect(() => {
    const editor = monaco.editor.createDiffEditor(containerRef.current!, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      glyphMargin: true,
      renderOverviewRuler: true,
      useInlineViewWhenSpaceIsLimited: false,
      // Both sides are read-only; hunk actions are ours, not Monaco's revert gutter menu.
      renderGutterMenu: false,
      renderMarginRevertIcon: false,
    });
    editorRef.current = editor;
    const modified = editor.getModifiedEditor();
    const glyphs = modified.createDecorationsCollection();

    const refreshGlyphs = () => {
      const controls = hunksRef.current;
      const changes = controls ? (editor.getLineChanges() ?? []) : [];
      const verb = controls?.mode === 'staged' ? 'Unstage' : 'Stage';
      glyphs.set(
        changes.map((change) => ({
          range: new monaco.Range(anchorLine(change), 1, anchorLine(change), 1),
          options: {
            glyphMarginClassName: `hunk-glyph codicon ${controls?.mode === 'staged' ? 'codicon-remove' : 'codicon-add'}`,
            glyphMarginHoverMessage: { value: `${verb} this hunk` },
          },
        })),
      );
    };
    refreshGlyphsRef.current = refreshGlyphs;

    const disposables = [
      editor.onDidUpdateDiff(() => {
        onChangeCount(editor.getLineChanges()?.length ?? null);
        refreshGlyphs();
      }),
      modified.onMouseDown((event) => {
        const controls = hunksRef.current;
        if (!controls || event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
        const line = event.target.position?.lineNumber;
        const change = (editor.getLineChanges() ?? []).find((c) => anchorLine(c) === line);
        if (change) controls.run(controls.mode === 'staged' ? 'unstage' : 'stage', change);
      }),
    ];

    // Context menu on both sides: the hunk under the cursor, or the selected lines.
    const sides: Array<[Side, monaco.editor.IStandaloneCodeEditor]> = [
      ['original', editor.getOriginalEditor()],
      ['modified', modified],
    ];
    const menu: Array<{ id: string; label: string; modes: string[]; action: LineAction; selection: boolean }> = [
      { id: 'stageHunk', label: 'Stage Hunk', modes: ['unstaged'], action: 'stage', selection: false },
      { id: 'stageLines', label: 'Stage Selected Lines', modes: ['unstaged'], action: 'stage', selection: true },
      { id: 'discardHunk', label: 'Discard Hunk', modes: ['unstaged'], action: 'discard', selection: false },
      { id: 'discardLines', label: 'Discard Selected Lines', modes: ['unstaged'], action: 'discard', selection: true },
      { id: 'unstageHunk', label: 'Unstage Hunk', modes: ['staged'], action: 'unstage', selection: false },
      { id: 'unstageLines', label: 'Unstage Selected Lines', modes: ['staged'], action: 'unstage', selection: true },
    ];
    for (const [side, sideEditor] of sides) {
      for (const [order, item] of menu.entries()) {
        disposables.push(
          sideEditor.addAction({
            id: `forklift.${item.id}`,
            label: item.label,
            contextMenuGroupId: '0_forklift',
            contextMenuOrder: order,
            run: (ed) => {
              const controls = hunksRef.current;
              if (!controls || !item.modes.includes(controls.mode)) return;
              if (item.selection) return controls.runSelection(item.action);
              const line = ed.getPosition()?.lineNumber ?? 0;
              const change = changeAt(editor.getLineChanges() ?? [], side, line);
              if (change) controls.run(item.action, change);
            },
          }),
        );
      }
    }

    return () => {
      for (const disposable of disposables) disposable.dispose();
      glyphs.clear();
      const model = editor.getModel();
      // Detach first so nothing inside the editor reacts to the models being disposed.
      editor.setModel(null);
      editor.dispose();
      model?.original.dispose();
      model?.modified.dispose();
      editorRef.current = null;
      refreshGlyphsRef.current = () => {};
    };
  }, [editorRef, onChangeCount]);

  useEffect(() => {
    const editor = editorRef.current!;
    const language = languageForPath(path);
    const previous = editor.getModel();
    const model = (text: string | null) => {
      const created = monaco.editor.createModel(text ?? '', language);
      created.updateOptions({ tabSize: tabSizeRef.current });
      return created;
    };
    editor.setModel({ original: model(data.original.text), modified: model(data.modified.text) });
    previous?.original.dispose();
    previous?.modified.dispose();
    onChangeCount(null);
  }, [data, path, editorRef, onChangeCount]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({
      renderSideBySide: prefs.sideBySide,
      ignoreTrimWhitespace: prefs.ignoreWhitespace,
      diffWordWrap: prefs.wordWrap ? 'on' : 'off',
      hideUnchangedRegions: { enabled: prefs.hideUnchanged, contextLineCount: prefs.contextLines },
      fontFamily: prefs.fontFamily,
      fontSize: prefs.fontSize,
    });
    tabSizeRef.current = prefs.tabSize;
    const model = editor.getModel();
    model?.original.updateOptions({ tabSize: prefs.tabSize });
    model?.modified.updateOptions({ tabSize: prefs.tabSize });
  }, [prefs, editorRef]);

  return <div className="diff-editor" ref={containerRef} />;
}
