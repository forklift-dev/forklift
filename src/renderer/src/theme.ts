import type { ITheme } from '@xterm/xterm';
import { APP_THEME, resolveTheme, THEME_TOKENS, type Theme } from '../../shared/themes';
import { monaco } from './monaco/setup';
import { getState, subscribe } from './state';

// Applies the chosen themes: the app's as CSS variables on <html>, the editor's as a Monaco theme plus the same
// variables scoped to editors (their decorations use them), and tells terminals to repaint.

export const THEME_EVENT = 'forklift:theme';
const EDITOR_THEME = 'forklift-editor';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const hex = (color: string) => color.slice(1);
/** The color with its alpha multiplied (#rrggbb → #rrggbbaa). */
function alpha(color: string, factor: number): string {
  const base = color.length === 9 ? color.slice(0, 7) : color;
  const current = color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1;
  return `${base}${Math.round(Math.min(1, current * factor) * 255).toString(16).padStart(2, '0')}`;
}

const variables = (theme: Theme) => THEME_TOKENS.map((token) => `--${token}: ${theme.tokens[token]};`).join(' ');

function monacoTheme({ tokens: t, scheme, highContrast }: Theme): monaco.editor.IStandaloneThemeData {
  return {
    base: highContrast ? (scheme === 'dark' ? 'hc-black' : 'hc-light') : scheme === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: hex(t['code-fg']), background: hex(t['code-bg']) },
      { token: 'comment', foreground: hex(t['code-comment']), fontStyle: 'italic' },
      { token: 'keyword', foreground: hex(t['code-keyword']) },
      { token: 'string', foreground: hex(t['code-string']) },
      { token: 'regexp', foreground: hex(t['code-string']) },
      { token: 'number', foreground: hex(t['code-number']) },
      { token: 'type', foreground: hex(t['code-type']) },
      { token: 'tag', foreground: hex(t['code-tag']) },
      { token: 'attribute.name', foreground: hex(t['code-type']) },
      { token: 'attribute.value', foreground: hex(t['code-string']) },
      { token: 'delimiter', foreground: hex(t['code-fg']) },
      { token: 'variable', foreground: hex(t['code-fg']) },
    ],
    colors: {
      'editor.background': t['code-bg'],
      'editor.foreground': t['code-fg'],
      'editorGutter.background': t['code-bg'],
      'editorLineNumber.foreground': t['code-line-number'],
      'editorLineNumber.activeForeground': t['code-fg'],
      'editor.selectionBackground': t['code-selection'],
      'editor.inactiveSelectionBackground': alpha(t['code-selection'], 0.6),
      'editor.lineHighlightBackground': alpha(t['bg-hover'], 0.5),
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': t.accent,
      'editorWidget.background': t['bg-raised'],
      'editorWidget.border': t.border,
      'editorHoverWidget.background': t['bg-raised'],
      'editorHoverWidget.border': t.border,
      'input.background': t['bg-input'],
      'input.foreground': t.fg,
      'input.border': t['input-border'],
      focusBorder: t.focus,
      'scrollbarSlider.background': t.scrollbar,
      'scrollbarSlider.hoverBackground': t['scrollbar-hover'],
      'scrollbarSlider.activeBackground': t['scrollbar-hover'],
      'diffEditor.insertedLineBackground': t['diff-added-bg'],
      'diffEditor.insertedTextBackground': alpha(t['diff-added-bg'], 2),
      'diffEditor.removedLineBackground': t['diff-removed-bg'],
      'diffEditor.removedTextBackground': alpha(t['diff-removed-bg'], 2),
      'diffEditorGutter.insertedLineBackground': t['diff-added-bg'],
      'diffEditorGutter.removedLineBackground': t['diff-removed-bg'],
      'diffEditor.diagonalFill': alpha(t['border'], 0.6),
      'diffEditor.unchangedRegionBackground': t['bg-panel'],
      'diffEditor.unchangedRegionForeground': t['fg-muted'],
      'editorOverviewRuler.border': '#00000000',
      // Conflict regions on the overview ruler.
      'editorOverviewRuler.warningForeground': t.warning,
      'editorIndentGuide.background1': alpha(t.border, 0.7),
      'menu.background': t['bg-raised'],
      'menu.foreground': t.fg,
      'menu.selectionBackground': t.selection,
      'menu.selectionForeground': t.fg,
    },
  };
}

/** ANSI colors for the embedded terminal, by scheme (programs assume these roles, not exact hues). */
const ANSI = {
  dark: ['#3b4252', '#ff7b72', '#7ee787', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#d0d7de', '#6e7681', '#ffa198', '#a5f3a0', '#f2cc60', '#a5d6ff', '#e2c5ff', '#7ee8f0', '#ffffff'],
  light: ['#24292f', '#b62324', '#116329', '#7d4e00', '#0550ae', '#8250df', '#1b7c83', '#6e7781', '#57606a', '#a40e26', '#1a7f37', '#953800', '#0969da', '#a475f9', '#3192aa', '#8c959f'],
} as const;
const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const;

let appTheme: Theme = resolveTheme('system', darkQuery.matches);

/** Colors for xterm.js from the app theme. */
export function terminalTheme(): ITheme {
  const t = appTheme.tokens;
  const ansi = Object.fromEntries(ANSI_NAMES.map((name, i) => [name, ANSI[appTheme.scheme][i]]));
  return { ...ansi, background: t['code-bg'], foreground: t['code-fg'], cursor: t.accent, cursorAccent: t['code-bg'], selectionBackground: t['code-selection'] };
}

let applied: [Theme, Theme] | null = null;
function apply(): void {
  const state = getState();
  const values = state.settings.values;
  const user = state.app.userThemes.themes;
  const app = resolveTheme(values['ui.theme'], darkQuery.matches, user);
  const editorId = values['ui.editorTheme'];
  const editor = editorId === APP_THEME ? app : resolveTheme(editorId, darkQuery.matches, user);
  // Themes are stable objects (built-in constants, or user themes until their files are read again).
  if (applied && applied[0] === app && applied[1] === editor) return;
  applied = [app, editor];
  appTheme = app;

  const root = document.documentElement;
  for (const token of THEME_TOKENS) root.style.setProperty(`--${token}`, app.tokens[token]);
  root.style.colorScheme = app.scheme;
  root.dataset['theme'] = app.id;
  root.dataset['editorTheme'] = editor.id;

  let style = document.getElementById('editor-theme') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'editor-theme';
    document.head.append(style);
  }
  // Decorations inside editors (diff tints, conflicts, blame) follow the editor theme.
  style.textContent = `.monaco-editor, .monaco-diff-editor, .hunk-view { ${variables(editor)} color-scheme: ${editor.scheme}; }`;
  monaco.editor.defineTheme(EDITOR_THEME, monacoTheme(editor));
  monaco.editor.setTheme(EDITOR_THEME);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Applies the themes now and whenever the settings, the user themes or the system's light/dark change. */
export function startThemes(): void {
  apply();
  subscribe(apply);
  darkQuery.addEventListener('change', apply);
}
