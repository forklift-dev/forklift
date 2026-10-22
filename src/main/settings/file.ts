import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  defaultSettings,
  isSettingKey,
  parseSettingValue,
  REPO_SETTING_KEYS,
  SETTING_KEYS,
  type RepoOverrides,
  type SettingKey,
  type SettingsState,
} from '../../shared/settings';

export const SETTINGS_VERSION = 1;

/**
 * On-disk shape: only values that differ from the defaults, so improved defaults reach existing users.
 * `version` is bumped together with a migration whenever a key is renamed or its meaning changes.
 */
interface SettingsFileData {
  version: number;
  settings: Record<string, unknown>;
  repositories: Record<string, Record<string, unknown>>;
}

/** Steps from version N to N+1, applied in order to files written by older versions. */
type Migration = (data: SettingsFileData) => SettingsFileData;
export const MIGRATIONS: Record<number, Migration> = {};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseValues(raw: unknown, where: string, problems: string[], keys: readonly SettingKey[] = SETTING_KEYS) {
  const values: Partial<Record<SettingKey, unknown>> = {};
  if (!isRecord(raw)) return values;
  for (const [key, value] of Object.entries(raw)) {
    if (!isSettingKey(key) || !keys.includes(key)) {
      problems.push(`${where}: unknown setting "${key}" was ignored`);
      continue;
    }
    try {
      values[key] = parseSettingValue(key, value);
    } catch (error) {
      problems.push(`${where}: ${(error as Error).message}; the default is used`);
    }
  }
  return values;
}

/** Turns file contents into state; invalid entries are dropped with a problem each. */
export function decodeSettings(text: string, migrations: Record<number, Migration> = MIGRATIONS): SettingsState & { newerVersion: boolean } {
  const data = JSON.parse(text) as unknown;
  if (!isRecord(data)) throw new SyntaxError('settings file does not contain an object');
  const problems: string[] = [];
  let version = typeof data['version'] === 'number' ? data['version'] : 0;
  let file: SettingsFileData = {
    version,
    settings: isRecord(data['settings']) ? data['settings'] : {},
    repositories: isRecord(data['repositories']) ? (data['repositories'] as SettingsFileData['repositories']) : {},
  };
  while (version < SETTINGS_VERSION) {
    const migrate = migrations[version];
    if (migrate) file = migrate(file);
    version++;
  }

  const values = { ...defaultSettings(), ...parseValues(file.settings, 'settings', problems) };
  const repos: Record<string, RepoOverrides> = {};
  for (const [root, overrides] of Object.entries(file.repositories)) {
    const parsed = parseValues(overrides, `repository ${root}`, problems, REPO_SETTING_KEYS);
    if (Object.keys(parsed).length) repos[root] = parsed as RepoOverrides;
  }
  return { values: values as SettingsState['values'], repos, problems, newerVersion: file.version > SETTINGS_VERSION };
}

export function encodeSettings(state: Pick<SettingsState, 'values' | 'repos'>): string {
  const defaults = defaultSettings();
  const differs = (key: SettingKey, value: unknown) => JSON.stringify(value) !== JSON.stringify(defaults[key]);
  const settings = Object.fromEntries(SETTING_KEYS.filter((key) => differs(key, state.values[key])).map((key) => [key, state.values[key]]));
  const repositories = Object.fromEntries(Object.entries(state.repos).filter(([, overrides]) => Object.keys(overrides).length));
  const data: SettingsFileData = { version: SETTINGS_VERSION, settings, repositories };
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** Reads and writes settings.json; writes are atomic (temporary file + rename) and serialized. */
export class SettingsFile {
  private queue: Promise<void> = Promise.resolve();
  private pending: string | null = null;

  constructor(readonly path: string) {}

  /** Never throws: a missing file gives defaults, a damaged one is kept aside and reported. */
  async load(): Promise<SettingsState> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { values: defaultSettings(), repos: {}, problems: [] };
      return { values: defaultSettings(), repos: {}, problems: [`Could not read ${this.path}: ${(error as Error).message}`] };
    }
    try {
      const { newerVersion, ...state } = decodeSettings(text);
      if (newerVersion) {
        // Written by a newer Forklift: keep a copy before this version rewrites it in its own format.
        const backup = `${this.path}.newer-backup`;
        await copyFile(this.path, backup).catch(() => {});
        state.problems.push(`Settings were saved by a newer version of Forklift; a copy was kept at ${backup}`);
      }
      return state;
    } catch (error) {
      const backup = `${this.path}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await rename(this.path, backup).catch(() => {});
      return {
        values: defaultSettings(),
        repos: {},
        problems: [`The settings file was damaged (${(error as Error).message}); defaults are used and the old file was kept at ${backup}`],
      };
    }
  }

  /** Queues a write of the latest state; intermediate states that were never written are skipped. */
  save(state: Pick<SettingsState, 'values' | 'repos'>): Promise<void> {
    this.pending = encodeSettings(state);
    const write = this.queue.then(() => this.flush());
    this.queue = write.catch(() => {}); // a failed write must not block later ones
    return write;
  }

  private async flush(): Promise<void> {
    const text = this.pending;
    if (text === null) return;
    this.pending = null;
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(temp, text, { encoding: 'utf8', flush: true });
      await rename(temp, this.path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }
}
