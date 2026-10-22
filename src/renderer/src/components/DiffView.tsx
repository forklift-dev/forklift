import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DiffTarget, FileDiff, FileVersion } from '../../../shared/diff';
import { languageForPath, monaco } from '../monaco/setup';
import { useCommand } from '../useCommand';

interface DiffPrefs {
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  wordWrap: boolean;
  hideUnchanged: boolean;
}

const PREFS_KEY = 'forklift.diffPrefs';
const DEFAULT_PREFS: DiffPrefs = { sideBySide: true, ignoreWhitespace: false, wordWrap: false, hideUnchanged: false };

// View preferences are a per-window convenience; storage may be unavailable, so fall back silently.
function loadPrefs(): DiffPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: DiffPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Why the text diff cannot be shown, or null when it can. */
function unavailableReason({ original, modified }: FileDiff): string | null {
  const describe = (v: FileVersion) => (v.exists ? formatSize(v.size) : 'none');
  if (original.binary || modified.binary) return `Binary file (${describe(original)} → ${describe(modified)})`;
  if (original.tooLarge || modified.tooLarge) return `File is too large to show (${describe(original)} → ${describe(modified)})`;
  return null;
}

interface DiffViewProps {
  target: DiffTarget;
  title: string;
  subtitle?: string;
  /** Changes when the underlying data may have changed (e.g. after a refresh of the working tree). */
  reloadKey?: unknown;
  actions?: ReactNode;
  onClose(): void;
}

export function DiffView({ target, title, subtitle, reloadKey, actions, onClose }: DiffViewProps) {
  const { data, error, loading } = useCommand('diff:file', [target], { reloadKey, keepPrevious: true });
  const [prefs, setPrefs] = useState(loadPrefs);
  const [changeCount, setChangeCount] = useState<number | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  const toggle = (key: keyof DiffPrefs) =>
    setPrefs((previous) => {
      const next = { ...previous, [key]: !previous[key] };
      savePrefs(next);
      return next;
    });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reason = data ? unavailableReason(data) : null;

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
          {actions}
          <button type="button" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
      </header>
      {error && <div className="diff-message error">{error}</div>}
      {!error && !data && loading && <div className="diff-message">Loading…</div>}
      {data && reason && <div className="diff-message">{reason}</div>}
      {data && !reason && <MonacoDiff data={data} path={target.path} prefs={prefs} editorRef={editorRef} onChangeCount={setChangeCount} />}
    </section>
  );
}

interface MonacoDiffProps {
  data: FileDiff;
  path: string;
  prefs: DiffPrefs;
  editorRef: { current: monaco.editor.IStandaloneDiffEditor | null };
  onChangeCount(count: number | null): void;
}

function MonacoDiff({ data, path, prefs, editorRef, onChangeCount }: MonacoDiffProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // One editor per mounted view; models are swapped when the file or its content changes.
  useEffect(() => {
    const editor = monaco.editor.createDiffEditor(containerRef.current!, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontSize: 12,
      renderOverviewRuler: true,
      useInlineViewWhenSpaceIsLimited: false,
      // Both sides are read-only; hunk actions are ours (T-021), not Monaco's revert gutter menu.
      renderGutterMenu: false,
      renderMarginRevertIcon: false,
    });
    editorRef.current = editor;
    const listener = editor.onDidUpdateDiff(() => onChangeCount(editor.getLineChanges()?.length ?? null));
    return () => {
      listener.dispose();
      const model = editor.getModel();
      // Detach first so nothing inside the editor reacts to the models being disposed.
      editor.setModel(null);
      editor.dispose();
      model?.original.dispose();
      model?.modified.dispose();
      editorRef.current = null;
    };
  }, [editorRef, onChangeCount]);

  useEffect(() => {
    const editor = editorRef.current!;
    const language = languageForPath(path);
    const previous = editor.getModel();
    editor.setModel({
      original: monaco.editor.createModel(data.original.text ?? '', language),
      modified: monaco.editor.createModel(data.modified.text ?? '', language),
    });
    previous?.original.dispose();
    previous?.modified.dispose();
    onChangeCount(null);
  }, [data, path, editorRef, onChangeCount]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      renderSideBySide: prefs.sideBySide,
      ignoreTrimWhitespace: prefs.ignoreWhitespace,
      diffWordWrap: prefs.wordWrap ? 'on' : 'off',
      hideUnchangedRegions: { enabled: prefs.hideUnchanged },
    });
  }, [prefs, editorRef]);

  return <div className="diff-editor" ref={containerRef} />;
}
