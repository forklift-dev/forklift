import { useEffect, useRef, useState } from 'react';
import type { FileVersion } from '../../shared/diff';
import { CODE_FONT, languageForPath, monaco } from './monaco/setup';

interface MergeData {
  path: string;
  base: FileVersion;
  local: FileVersion;
  remote: FileVersion;
  merged: FileVersion;
}

function sideProblem(version: FileVersion): string | null {
  if (!version.exists) return 'Not present';
  if (version.binary) return 'Binary file';
  if (version.tooLarge) return 'File is too large to edit';
  if (version.lossy) return 'File is not valid UTF-8';
  return null;
}

export function ToolMergeApp() {
  const host = useRef<HTMLDivElement>(null);
  const resultModel = useRef<monaco.editor.ITextModel | null>(null);
  const [data, setData] = useState<MergeData | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.forklift.toolMerge().then((value) => {
      if (cancelled) return;
      document.title = value.path;
      setData(value);
    }, (failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
    });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') window.close(); };
    window.addEventListener('keydown', escape);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', escape);
    };
  }, []);

  useEffect(() => {
    if (!data || !host.current) return;
    const versions = [data.base, data.local, data.remote, data.merged];
    if (versions.some((version) => version.exists && (version.binary || version.tooLarge || version.lossy))) return;
    const editors: monaco.editor.IStandaloneCodeEditor[] = [];
    const models: monaco.editor.ITextModel[] = [];
    for (const [index, version] of versions.entries()) {
      const model = monaco.editor.createModel(version.text ?? '', languageForPath(data.path));
      models.push(model);
      const pane = host.current.querySelector<HTMLElement>(`[data-side="${['base', 'local', 'remote', 'result'][index]}"]`)!;
      editors.push(monaco.editor.create(pane, {
        model, readOnly: index !== 3, automaticLayout: true, minimap: { enabled: false },
        scrollBeyondLastLine: false, fontFamily: CODE_FONT, fontSize: 13,
      }));
      if (index === 3) resultModel.current = model;
    }
    return () => {
      resultModel.current = null;
      for (const editor of editors) editor.dispose();
      for (const model of models) model.dispose();
    };
  }, [data]);

  const problem = data?.merged.exists && (data.merged.binary || data.merged.tooLarge || data.merged.lossy)
    ? sideProblem(data.merged)
    : null;
  const canSave = Boolean(data && !problem && ![data.base, data.local, data.remote].some((version) => version.exists && (version.binary || version.tooLarge || version.lossy)));
  const save = async () => {
    const text = resultModel.current?.getValue();
    if (text === undefined) return;
    setSaving(true);
    setError('');
    try { await window.forklift.saveToolMerge(text); }
    catch (failure) {
      setSaving(false);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <main className="tool-merge-window" ref={host}>
      <header>
        <strong>{data?.path ?? 'Forklift Merge'}</strong>
        <div><button disabled={!canSave || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save and close'}</button><button onClick={() => window.close()}>Cancel</button></div>
      </header>
      {error && <p role="alert">{error}</p>}
      {data && problem && <p>{problem}. The merge result cannot be saved from this window.</p>}
      {data && !problem && [data.base, data.local, data.remote].some((version) => version.exists && (version.binary || version.tooLarge || version.lossy)) && <p>A merge input is binary, too large, or not valid UTF-8.</p>}
      <div className="tool-merge-sides">
        {(['base', 'local', 'remote'] as const).map((side) => (
          <section key={side}><h2>{side === 'base' ? 'Base' : side === 'local' ? 'Local' : 'Remote'}</h2><div className="tool-merge-editor" data-side={side} />
            {data && sideProblem(data[side]) && <div className="tool-merge-message">{sideProblem(data[side])}</div>}
          </section>
        ))}
      </div>
      <section className="tool-merge-result"><h2>Result — edit, then save</h2><div className="tool-merge-editor" data-side="result" />
        {data && problem && <div className="tool-merge-message">{problem}</div>}
      </section>
    </main>
  );
}
