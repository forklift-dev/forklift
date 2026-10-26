import { useState } from 'react';
import { t, translate } from '../../../../shared/i18n';
import { APP_THEME, BUILTIN_THEMES, resolveTheme, SYSTEM_THEME, type Theme } from '../../../../shared/themes';
import { invoke } from '../../api';
import { tx } from '../../i18n';
import { useAppState } from '../../state';
import { errorText, type ControlProps } from './SettingRow';

/** A small picture of the app in the theme: panels, text, a button and graph lanes. */
function AppPreview({ theme }: { theme: Theme }) {
  const colors = theme.tokens;
  return (
    <span className="theme-preview" style={{ background: colors.bg, borderColor: colors.border }} aria-hidden="true">
      <span className="theme-preview-bar" style={{ background: colors['bg-panel'], borderColor: colors.border }}>
        <span style={{ background: colors['primary-bg'] }} />
      </span>
      {[0, 1, 2].map((row) => (
        <span key={row} className="theme-preview-row" style={row === 0 ? { background: colors.selection } : undefined}>
          <span className="theme-preview-dot" style={{ background: colors[`graph-${row}` as 'graph-0'] }} />
          <span className="theme-preview-text" style={{ background: row === 0 ? colors.fg : colors['fg-muted'], width: `${60 - row * 12}%` }} />
        </span>
      ))}
    </span>
  );
}

/** Code with an added and a removed line, as the editor shows it. */
function EditorPreview({ theme }: { theme: Theme }) {
  const tokens = theme.tokens;
  const line = (colors: string[], background?: string) => (
    <span className="theme-preview-row" style={background ? { background } : undefined}>
      <span className="theme-preview-gutter" style={{ background: tokens['code-line-number'] }} />
      {colors.map((color, i) => (
        <span key={i} className="theme-preview-text" style={{ background: color, width: `${14 + ((i * 7) % 12)}%` }} />
      ))}
    </span>
  );
  return (
    <span className="theme-preview" style={{ background: tokens['code-bg'], borderColor: tokens.border }} aria-hidden="true">
      {line([tokens['code-keyword'], tokens['code-type'], tokens['code-fg']])}
      {line([tokens['code-fg'], tokens['code-string']], tokens['diff-removed-bg'])}
      {line([tokens['code-fg'], tokens['code-number']], tokens['diff-added-bg'])}
      {line([tokens['code-comment'], tokens['code-comment']])}
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
      ? { value: APP_THEME, label: t('Same as the app'), preview: resolveTheme(appThemeId, dark, user) }
      : { value: SYSTEM_THEME, label: t('System'), preview: [resolveTheme('forklift-light', false), resolveTheme('forklift-dark', true)] },
    ...[...BUILTIN_THEMES, ...user].map((theme) => ({ value: theme.id, label: theme.name, preview: theme })),
  ];
  const Preview = editor ? EditorPreview : AppPreview;
  return (
    <div id={id} className="theme-picker" role="radiogroup" aria-label={editor ? t('Editor theme') : t('Theme')}>
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
            {option.value.startsWith('user:') ? option.label : translate(option.label)}
            {option.value.startsWith('user:') && <span className="theme-option-note"> · {t('custom')}</span>}
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
        {tx('Custom themes are .jsonc files in the themes folder: {example}. They are read again when a file changes. {open}', {
          example: <code>{'{ "meta": { "name": "…", "extends": "forklift-dark" }, "tokens": { "accent": "#ff8800" } }'}</code>,
          open: (
            <button type="button" className="link-button" disabled={!folder} onClick={open}>
              {t('Open themes folder')}
            </button>
          ),
        })}
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
