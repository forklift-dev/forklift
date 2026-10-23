// A trimmed Monaco build: the editor API, the diff editor and a few editing contributions, plus
// Monarch syntax highlighting for all languages. Language services (TypeScript, JSON, CSS, HTML)
// are left out: they need their own workers and a diff view does not use them.
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/editor/browser/widget/diffEditor/diffEditor.contribution';
import 'monaco-editor/features/find/register';
import 'monaco-editor/editor/contrib/folding/browser/folding';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter';
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution';
import 'monaco-editor/basic-languages/monaco.contribution';
// oxlint-disable-next-line import/default -- virtual module: Vite bundles the worker and exports its constructor
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

// The diff computation runs in this worker; it is bundled as a 'self' asset, so the CSP stays strict.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

/** Code font when the user has not chosen one; Monaco measures it, so CSS variables cannot be used here. */
export const CODE_FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";

/** Monaco language id for a file name, from the languages' registered extensions and file names. */
export function languageForPath(path: string): string {
  const name = path.split('/').pop()!.toLowerCase();
  for (const language of monaco.languages.getLanguages()) {
    if (language.filenames?.some((f) => f.toLowerCase() === name)) return language.id;
    if (language.extensions?.some((ext) => name.endsWith(ext.toLowerCase()))) return language.id;
  }
  return 'plaintext';
}

export { monaco };
