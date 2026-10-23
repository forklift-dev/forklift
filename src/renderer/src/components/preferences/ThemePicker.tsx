import { useState } from 'react';
import { APP_THEME, BUILTIN_THEMES, resolveTheme, SYSTEM_THEME, type Theme } from '../../../../shared/themes';
import { invoke } from '../../api';
import { useAppState } from '../../state';
import { errorText, type ControlProps } from './SettingRow';

/** A small picture of the app in the theme: panels, text, a button and graph lanes. */
function AppPreview({ theme }: { theme: Theme }) {
  const t = theme.tokens;
  return (
    <span className="theme-preview" style={{ background: t.bg, borderColor: t.border }} aria-hidden="true">
      <span className="theme-preview-bar" style={{ background: t['bg-panel'], borderColor: t.border }}>
        <span style={{ background: t['primary-bg'] }} />
      </span>
      {[0, 1, 2].map((row) => (
        <span key={row} className="theme-preview-row" style={row === 0 ? { background: t.selection } : undefined}>
          <span className="theme-preview-dot" style={{ background: t[`graph-${row}` as 'graph-0'] }} />
          <span className="theme-preview-text" style={{ background: row === 0 ? t.fg : t['fg-muted'], width: `${60 - row * 12}%` }} />
        </span>
      ))}
    </span>
  );
}

/** Code with an added and a removed line, as the editor shows it. */
function EditorPreview({ theme }: { theme: Theme }) {
  const t = theme.tokens;
  const line = (colors: string[], background?: string) => (
    <span className="theme-preview-row" style={background ? { background } : undefined}>
      <span className="theme-preview-gutter" style={{ background: t['code-line-number'] }} />
      {colors.map((color, i) => (
        <span key={i} className="theme-preview-text" style={{ background: color, width: `${14 + ((i * 7) % 12)}%` }} />
      ))}
    </span>
  );
  return (
    <span className="theme-preview" style={{ background: t['code-bg'], borderColor: t.border }} aria-hidden="true">
      {line([t['code-keyword'], t['code-type'], t['code-fg']])}
      {line([t['code-fg'], t['code-string']], t['diff-removed-bg'])}
      {line([t['code-fg'], t['code-number']], t['diff-added-bg'])}
      {line([t['code-comment'], t['code-comment']])}
    </span>
  );
}

interface Option {
  value: string;
  label: string;
  preview: Theme | [Theme, Theme];
}

/** Picks the app theme (`ui.theme`) or the editor theme (`ui.editorTheme`); applies at once. */
export function ThemePicker({ id, settingKey, value, save }: ControlProps) {
  const user = useAppState((s) => s.app.userThemes.themes);
  const editor = settingKey === 'ui.editorTheme';
  const appThemeId = useAppState((s) => s.settings.values['ui.theme']);
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const options: Option[] = [
    editor
      ? { value: APP_THEME, label: 'Same as the app', preview: resolveTheme(appThemeId, dark, user) }
      : { value: SYSTEM_THEME, label: 'System', preview: [resolveTheme('forklift-light', false), resolveTheme('forklift-dark', true)] },
    ...[...BUILTIN_THEMES, ...user].map((theme) => ({ value: theme.id, label: theme.name, preview: theme })),
  ];
  const Preview = editor ? EditorPreview : AppPreview;
  return (
    <div id={id} className="theme-picker" role="radiogroup" aria-label={editor ? 'Editor theme' : 'Theme'}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`theme-option${value === option.value ? ' selected' : ''}`}
          data-theme-id={option.value}
          onClick={() => void save(option.value)}
        >
          {Array.isArray(option.preview) ? (
            <span className="theme-preview-split">
              <Preview theme={option.preview[0]} />
              <Preview theme={option.preview[1]} />
            </span>
          ) : (
            <Preview theme={option.preview} />
          )}
          <span className="theme-option-label">
            {option.label}
            {option.value.startsWith('user:') && <span className="theme-option-note"> · custom</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Where user themes live, how to write one, and what is wrong with the broken ones. */
export function UserThemesNote() {
  const { problems, folder } = useAppState((s) => s.app.userThemes);
  const [error, setError] = useState<string | null>(null);
  const open = () => {
    setError(null);
    invoke('themes:openFolder').catch((failure: unknown) => setError(errorText(failure)));
  };
  return (
    <div className="user-themes">
      <p className="hint">
        Custom themes are <code>.jsonc</code> files in the themes folder: <code>{'{ "meta": { "name": "…", "extends": "forklift-dark" }, "tokens": { "accent": "#ff8800" } }'}</code>. They are read again when a file changes.{' '}
        <button type="button" className="link-button" disabled={!folder} onClick={open}>
          Open themes folder
        </button>
      </p>
      {error && <p className="setting-error">{error}</p>}
      {problems.length > 0 && (
        <ul className="theme-problems" role="alert">
          {problems.map((problem) => (
            <li key={problem.file}>
              <strong>{problem.file}</strong>: {problem.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
