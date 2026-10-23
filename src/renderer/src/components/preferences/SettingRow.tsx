import { useId, useState, type ReactNode } from 'react';
import { settingField, type SettingKey, type SettingsValues } from '../../../../shared/settings';
import { invoke } from '../../api';
import { useAppState } from '../../state';

/** Saves one setting globally or as `repo`'s override; null resets it. Resolves to an error message or null. */
export async function saveSetting(key: SettingKey, value: unknown, repo: string | null): Promise<string | null> {
  try {
    await invoke('settings:update', { ...(repo && { repo }), values: { [key]: value } });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface ControlProps<K extends SettingKey = SettingKey> {
  id: string;
  settingKey: K;
  value: SettingsValues[K];
  repo: string | null;
  /** Resolves to true when the value was accepted by main. */
  save(value: unknown): Promise<boolean>;
}

interface SettingRowProps {
  settingKey: SettingKey;
  repo: string | null;
  render(props: ControlProps): ReactNode;
  /** Shown under the control, e.g. the detected git version. */
  extra?: ReactNode;
}

/** Label, description and override state of one setting around its control; errors stay next to it. */
export function SettingRow({ settingKey, repo, render, extra }: SettingRowProps) {
  const field = settingField(settingKey);
  const globalValue = useAppState((s) => s.settings.values[settingKey]);
  const override = useAppState((s) => (repo ? s.settings.repos[repo]?.[settingKey] : undefined));
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const save = async (value: unknown) => {
    setError(null);
    const failure = await saveSetting(settingKey, value, repo);
    setError(failure);
    return failure === null;
  };

  return (
    <div className="setting-row" data-setting={settingKey}>
      <div className="setting-text">
        <label htmlFor={id}>{field.label}</label>
        {field.description && <p>{field.description}</p>}
        {repo &&
          (override === undefined ? (
            <p className="setting-scope">Uses the setting for all repositories</p>
          ) : (
            <p className="setting-scope overridden">
              Set for this repository{' '}
              <button type="button" className="link-button" onClick={() => void save(null)}>
                Use the setting for all repositories
              </button>
            </p>
          ))}
      </div>
      <div className="setting-control">
        {render({ id, settingKey, value: override ?? globalValue, repo, save })}
        {extra}
        {error && (
          <p className="setting-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export function BooleanControl({ id, value, save }: ControlProps) {
  return <input id={id} type="checkbox" checked={value as boolean} onChange={(event) => void save(event.target.checked)} />;
}

export function EnumControl({ id, settingKey, value, save }: ControlProps) {
  const field = settingField(settingKey);
  if (field.type !== 'enum') return null;
  return (
    <select id={id} value={value as string} onChange={(event) => void save(event.target.value)}>
      {field.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Text and number inputs keep a draft and save on Enter or when focus leaves. */
export function TextControl(props: ControlProps & { browse?: 'executable' | 'folder' }) {
  // Remounted when the stored value changes, so the draft starts from it.
  return <TextDraft key={String(props.value)} {...props} />;
}

function TextDraft({ id, settingKey, value, save, browse }: ControlProps & { browse?: 'executable' | 'folder' }) {
  const field = settingField(settingKey);
  const [draft, setDraft] = useState(String(value));
  const numeric = field.type === 'integer';

  const commit = (text = draft) => {
    if (text === String(value)) return;
    void save(numeric ? (text.trim() === '' ? Number.NaN : Number(text)) : text);
  };

  const pick = async () => {
    const path = await (browse === 'folder' ? invoke('repo:pick', 'parent') : invoke('settings:browseExecutable'));
    if (path) {
      setDraft(path);
      commit(path);
    }
  };

  return (
    <span className="text-control">
      <input
        id={id}
        type={numeric ? 'number' : 'text'}
        value={draft}
        spellCheck={false}
        {...(field.type === 'integer' && { min: field.min, max: field.max, className: 'number-input' })}
        {...(field.type === 'string' && { placeholder: field.placeholder, maxLength: field.maxLength })}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape' && draft !== String(value)) {
            event.preventDefault();
            setDraft(String(value));
          }
        }}
      />
      {browse && (
        <button type="button" onClick={() => void pick()}>
          Browse…
        </button>
      )}
    </span>
  );
}
