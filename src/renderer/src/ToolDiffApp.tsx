import { useEffect, useRef, useState } from 'react';
import type { FileDiff } from '../../shared/diff';
import { CODE_FONT, languageForPath, monaco } from './monaco/setup';

export function ToolDiffApp() {
  const host = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ path: string; diff: FileDiff } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void window.forklift.toolDiff().then((value) => {
      if (!cancelled) {
        document.title = value.path;
        setResult(value);
      }
    }, (failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
    });
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') window.close();
    };
    window.addEventListener('keydown', escape);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', escape);
    };
  }, []);

  useEffect(() => {
    if (!result || !host.current) return;
    const { original, modified } = result.diff;
    const unavailable = original.binary || modified.binary
      ? 'Binary file'
      : original.tooLarge || modified.tooLarge
        ? 'File is too large to show'
        : null;
    if (unavailable) return;
    const editor = monaco.editor.createDiffEditor(host.current, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      originalEditable: false,
      fontFamily: CODE_FONT,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    });
    const language = languageForPath(result.path);
    const before = monaco.editor.createModel(original.text ?? '', language);
    const after = monaco.editor.createModel(modified.text ?? '', language);
    editor.setModel({ original: before, modified: after });
    return () => {
      editor.dispose();
      before.dispose();
      after.dispose();
    };
  }, [result]);

  const unavailable = result && (result.diff.original.binary || result.diff.modified.binary
    ? 'This file is binary and cannot be shown as text.'
    : result.diff.original.tooLarge || result.diff.modified.tooLarge
      ? 'This file is too large to show.'
      : !result.diff.original.exists || !result.diff.modified.exists
        ? 'One side of this file does not exist.'
        : null);

  return (
    <main className="tool-diff-window">
      <header><strong>{result?.path ?? 'Forklift Diff'}</strong><button onClick={() => window.close()}>Close</button></header>
      {error ? <p role="alert">Could not load diff: {error}</p> : unavailable ? <p>{unavailable}</p> : null}
      <div className="diff-editor" ref={host} />
    </main>
  );
}
