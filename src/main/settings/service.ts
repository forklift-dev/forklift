import { isAbsolute } from 'node:path';
import {
  effectiveSettings,
  isSettingKey,
  parseSettingValue,
  REPO_SETTING_KEYS,
  settingField,
  type SettingKey,
  type SettingsValues,
} from '../../shared/settings';
import { APP_THEME, SYSTEM_THEME, THEME_ID } from '../../shared/themes';
import { findExecutable } from '../external/which';
import type { Runner } from '../process/types';
import type { AppStore } from '../store';
import { settingsChanged, settingsLoaded, type SettingsChange } from '../store/settingsSlice';
import type { SettingsFile } from './file';

export interface SettingsServiceDeps {
  store: AppStore;
  file: SettingsFile;
  runner: Pick<Runner, 'environment'>;
  /** Whether overrides may be stored for this repository root (it is open in the app). */
  isOpenRepo(root: string): boolean;
  /** Whether a theme with this id exists (built-in or a user theme file). */
  themeExists?(id: string): boolean;
}

const MAX_PATCH_KEYS = 64;

/** Owns the settings slice: loads it, validates changes from windows and persists every change. */
export class SettingsService {
  constructor(private readonly deps: SettingsServiceDeps) {}

  async load(): Promise<void> {
    const { store, file } = this.deps;
    store.dispatch(settingsLoaded(await file.load()));
    let saved = store.getState().settings;
    store.subscribe(() => {
      const current = store.getState().settings;
      if (current.values === saved.values && current.repos === saved.repos) return;
      saved = current;
      file.save(current).catch((error: unknown) => console.error('[settings] could not save:', error));
    });
  }

  get values(): SettingsValues {
    return this.deps.store.getState().settings.values;
  }

  /** Global values with the repository's overrides applied. */
  effective(root?: string | null): SettingsValues {
    const { values, repos } = this.deps.store.getState().settings;
    return root ? effectiveSettings(values, repos[root]) : values;
  }

  /** Validates a patch from a window (untrusted shape) and applies it. */
  async update(patch: unknown): Promise<void> {
    if (typeof patch !== 'object' || patch === null) throw new TypeError('patch must be an object');
    const { repo, values } = patch as Record<string, unknown>;
    if (repo !== undefined && (typeof repo !== 'string' || !this.deps.isOpenRepo(repo))) {
      throw new TypeError('Repository settings can only be changed for an open repository');
    }
    if (typeof values !== 'object' || values === null || Array.isArray(values)) throw new TypeError('values must be an object');
    const entries = Object.entries(values);
    if (entries.length === 0 || entries.length > MAX_PATCH_KEYS) throw new TypeError('values must name 1 to 64 settings');

    const change: SettingsChange = { ...(repo !== undefined && { repo }), values: {} };
    for (const [key, value] of entries) {
      if (!isSettingKey(key)) throw new TypeError(`Unknown setting "${key}"`);
      if (repo !== undefined && !REPO_SETTING_KEYS.includes(key)) throw new TypeError(`${key} cannot be set per repository`);
      const parsed = value === null ? null : parseSettingValue(key, value);
      if (parsed !== null) await this.checkProgram(key, parsed);
      if (parsed !== null) this.checkKind(key, parsed);
      (change.values as Record<SettingKey, unknown>)[key] = parsed;
    }
    this.deps.store.dispatch(settingsChanged(change));
  }

  private checkKind(key: SettingKey, value: unknown): void {
    const field = settingField(key);
    if (field.type !== 'string') return;
    if (field.kind === 'folder' && value && !isAbsolute(value as string)) throw new TypeError('Enter a full folder path (or leave it empty)');
    if (field.kind === 'theme' || field.kind === 'editorTheme') {
      const special = field.kind === 'theme' ? SYSTEM_THEME : APP_THEME;
      const id = value as string;
      if (id !== special && (!THEME_ID.test(id) || !(this.deps.themeExists?.(id) ?? true))) throw new TypeError(`There is no theme "${id}"`);
    }
  }

  /** Programs named in settings must exist when chosen; later they may disappear and fail with a clear error. */
  private async checkProgram(key: SettingKey, value: unknown): Promise<void> {
    const type = settingField(key).type;
    const custom = (type === 'appTool' || type === 'gitTool') && (value as { mode: string }).mode === 'custom';
    const command = key === 'git.executable' || key === 'terminal.shell' ? (value as string) : custom ? (value as { command: string }).command : '';
    if (!command) return;
    if (key === 'git.executable' && !isAbsolute(command) && command !== 'git') {
      throw new TypeError('Git executable must be a full path (or empty to use git from PATH)');
    }
    if (!(await findExecutable(command, await this.deps.runner.environment()))) {
      throw new TypeError(`"${command}" was not found or is not executable`);
    }
  }
}
