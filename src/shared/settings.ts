// Application settings: one declarative schema drives the types, defaults, validation, the
// Preferences screen (sections, labels, search) and which settings a repository may override.

/** A program with arguments; placeholders are substituted per argument, never through a shell. */
export interface CommandLine {
  command: string;
  args: string[];
}

/** External editor or terminal: detected automatically, a detected program picked by id, or a custom command. */
export type AppToolSetting = { mode: 'auto' } | { mode: 'preset'; id: string } | ({ mode: 'custom' } & CommandLine);

/**
 * External diff or merge tool, always run through `git difftool`/`git mergetool`:
 * whatever git config says, a tool git knows by name, or a custom command with $LOCAL/$REMOTE/$BASE/$MERGED.
 */
export type GitToolSetting =
  | { mode: 'git-config' }
  | { mode: 'tool'; name: string }
  | ({ mode: 'custom'; trustExitCode: boolean } & CommandLine);

export type AppToolKind = 'editor' | 'terminal';
export type GitToolKind = 'diff' | 'merge';
export type ToolKind = AppToolKind | GitToolKind;

export const SETTINGS_SECTIONS = {
  general: 'General',
  git: 'Git',
  diff: 'Diff',
  editor: 'Editor',
  tools: 'External tools',
} as const;
export type SettingsSection = keyof typeof SETTINGS_SECTIONS;

interface FieldBase {
  section: SettingsSection;
  label: string;
  description?: string;
  /** May be overridden per repository. */
  repo?: boolean;
}

export type SettingField =
  | (FieldBase & { type: 'boolean'; default: boolean })
  | (FieldBase & { type: 'integer'; default: number; min: number; max: number })
  | (FieldBase & { type: 'enum'; default: string; options: readonly { value: string; label: string }[] })
  | (FieldBase & { type: 'string'; default: string; maxLength: number; placeholder?: string; kind?: 'executable' })
  | (FieldBase & { type: 'appTool'; default: AppToolSetting; tool: AppToolKind })
  | (FieldBase & { type: 'gitTool'; default: GitToolSetting; tool: GitToolKind });

export const SETTING_FIELDS = {
  'general.restoreTabs': {
    section: 'general',
    type: 'boolean',
    default: true,
    label: 'Reopen repositories at startup',
    description: 'Open the tabs that were open when Forklift was last closed.',
  },
  'general.autoFetch': {
    section: 'general',
    type: 'boolean',
    default: true,
    label: 'Fetch automatically',
    description: 'Fetch the open repository in the background while Forklift is in use. It never asks for passwords: only stored credentials are used.',
  },
  'general.autoFetchMinutes': { section: 'general', type: 'integer', default: 10, min: 1, max: 120, label: 'Auto-fetch every (minutes)' },
  'general.fetchPrune': {
    section: 'general',
    type: 'boolean',
    default: false,
    label: 'Prune when fetching',
    description: 'Remove remote branches that were deleted on the remote (git fetch --prune).',
  },
  'git.executable': {
    section: 'git',
    type: 'string',
    kind: 'executable',
    default: '',
    maxLength: 4096,
    placeholder: 'git from PATH',
    label: 'Git executable',
    description: 'Full path to the git program for network operations, hooks and external tools. Empty: git found in PATH.',
  },
  'diff.layout': {
    section: 'diff',
    type: 'enum',
    default: 'split',
    options: [
      { value: 'split', label: 'Split (side by side)' },
      { value: 'inline', label: 'Inline' },
      { value: 'hunk', label: 'Hunks (only the changed fragments)' },
      { value: 'file', label: 'File (the whole file, changes highlighted)' },
    ],
    label: 'Layout',
  },
  'diff.ignoreWhitespace': { section: 'diff', type: 'boolean', default: false, label: 'Ignore whitespace changes' },
  'diff.wordWrap': { section: 'diff', type: 'boolean', default: false, label: 'Wrap long lines' },
  'diff.hideUnchanged': { section: 'diff', type: 'boolean', default: false, label: 'Collapse unchanged regions' },
  'diff.contextLines': {
    section: 'diff',
    type: 'integer',
    default: 3,
    min: 0,
    max: 50,
    label: 'Context lines',
    description: 'Unchanged lines kept around each change when unchanged regions are collapsed.',
  },
  'editor.fontFamily': {
    section: 'editor',
    type: 'string',
    default: '',
    maxLength: 200,
    placeholder: 'Default monospace font',
    label: 'Font family',
    description: 'CSS font list for code, e.g. "JetBrains Mono", monospace.',
  },
  'editor.fontSize': { section: 'editor', type: 'integer', default: 13, min: 8, max: 32, label: 'Font size' },
  'editor.tabSize': { section: 'editor', type: 'integer', default: 4, min: 1, max: 16, label: 'Tab width' },
  'tools.editor': {
    section: 'tools',
    type: 'appTool',
    tool: 'editor',
    default: { mode: 'auto' },
    repo: true,
    label: 'Editor',
    description: 'Opens files from the Edit buttons. Arguments may use {file}, {line} and {dir}.',
  },
  'tools.terminal': {
    section: 'tools',
    type: 'appTool',
    tool: 'terminal',
    default: { mode: 'auto' },
    repo: true,
    label: 'Terminal',
    description: 'Opens the repository folder from the Terminal button. Arguments may use {dir}.',
  },
  'tools.diff': {
    section: 'tools',
    type: 'gitTool',
    tool: 'diff',
    default: { mode: 'git-config' },
    repo: true,
    label: 'Diff tool',
    description: 'External diff, run through git difftool. A custom command may use $LOCAL and $REMOTE.',
  },
  'tools.merge': {
    section: 'tools',
    type: 'gitTool',
    tool: 'merge',
    default: { mode: 'git-config' },
    repo: true,
    label: 'Merge tool',
    description: 'Conflict resolution, run through git mergetool. A custom command may use $LOCAL, $REMOTE, $BASE and $MERGED.',
  },
} as const satisfies Record<string, SettingField>;

type Fields = typeof SETTING_FIELDS;
export type SettingKey = keyof Fields;

type ValueOf<F> = F extends { type: 'boolean' }
  ? boolean
  : F extends { type: 'integer' }
    ? number
    : F extends { type: 'enum'; options: readonly { value: infer V }[] }
      ? V
      : F extends { type: 'string' }
        ? string
        : F extends { type: 'appTool' }
          ? AppToolSetting
          : F extends { type: 'gitTool' }
            ? GitToolSetting
            : never;

export type SettingsValues = { -readonly [K in SettingKey]: ValueOf<Fields[K]> };
/** Values a repository overrides; absent keys inherit the global value. */
export type RepoOverrides = Partial<SettingsValues>;

export const SETTING_KEYS = Object.keys(SETTING_FIELDS) as SettingKey[];
export const REPO_SETTING_KEYS = SETTING_KEYS.filter((key) => (SETTING_FIELDS[key] as SettingField).repo === true);

export function settingField(key: SettingKey): SettingField {
  return SETTING_FIELDS[key];
}

export function isSettingKey(value: unknown): value is SettingKey {
  return typeof value === 'string' && Object.hasOwn(SETTING_FIELDS, value);
}

export function defaultSettings(): SettingsValues {
  return Object.fromEntries(SETTING_KEYS.map((key) => [key, structuredClone(SETTING_FIELDS[key].default)])) as SettingsValues;
}

/** Global values with a repository's overrides applied. */
export function effectiveSettings(values: SettingsValues, overrides: RepoOverrides | undefined): SettingsValues {
  return overrides ? { ...values, ...overrides } : values;
}

export class SettingValueError extends TypeError {
  constructor(key: string, problem: string) {
    super(`${key}: ${problem}`);
    this.name = 'SettingValueError';
  }
}

const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;
// Preset ids and git tool names are identifiers such as "code", "gnome-terminal", "bc4".
const TOOL_ID = /^[A-Za-z0-9][\w.+-]{0,63}$/;

function parseCommandLine(key: string, raw: Record<string, unknown>): CommandLine {
  const { command, args } = raw;
  if (typeof command !== 'string' || command.trim() === '') throw new SettingValueError(key, 'command must be a non-empty string');
  if (command.length > MAX_ARG_LENGTH || command.includes('\0')) throw new SettingValueError(key, 'command is not a valid path');
  if (!Array.isArray(args) || args.length > MAX_ARGS) throw new SettingValueError(key, `args must be an array of at most ${MAX_ARGS} strings`);
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length > MAX_ARG_LENGTH || arg.includes('\0')) throw new SettingValueError(key, 'args must be strings');
  }
  return { command: command.trim(), args: [...(args as string[])] };
}

function parseObject(key: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SettingValueError(key, 'must be an object');
  return value as Record<string, unknown>;
}

function parseAppTool(key: string, value: unknown): AppToolSetting {
  const raw = parseObject(key, value);
  switch (raw['mode']) {
    case 'auto':
      return { mode: 'auto' };
    case 'preset':
      if (typeof raw['id'] !== 'string' || !TOOL_ID.test(raw['id'])) throw new SettingValueError(key, 'preset id is invalid');
      return { mode: 'preset', id: raw['id'] };
    case 'custom':
      return { mode: 'custom', ...parseCommandLine(key, raw) };
    default:
      throw new SettingValueError(key, 'mode must be auto, preset or custom');
  }
}

function parseGitTool(key: string, value: unknown): GitToolSetting {
  const raw = parseObject(key, value);
  switch (raw['mode']) {
    case 'git-config':
      return { mode: 'git-config' };
    case 'tool':
      if (typeof raw['name'] !== 'string' || !TOOL_ID.test(raw['name'])) throw new SettingValueError(key, 'tool name is invalid');
      return { mode: 'tool', name: raw['name'] };
    case 'custom':
      if (typeof raw['trustExitCode'] !== 'boolean') throw new SettingValueError(key, 'trustExitCode must be a boolean');
      return { mode: 'custom', trustExitCode: raw['trustExitCode'], ...parseCommandLine(key, raw) };
    default:
      throw new SettingValueError(key, 'mode must be git-config, tool or custom');
  }
}

/** Validates a value from the renderer or the settings file; returns a clean copy or throws SettingValueError. */
export function parseSettingValue<K extends SettingKey>(key: K, value: unknown): SettingsValues[K] {
  const field: SettingField = SETTING_FIELDS[key];
  switch (field.type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new SettingValueError(key, 'must be true or false');
      return value as SettingsValues[K];
    case 'integer':
      if (!Number.isInteger(value) || (value as number) < field.min || (value as number) > field.max) {
        throw new SettingValueError(key, `must be a whole number from ${field.min} to ${field.max}`);
      }
      return value as SettingsValues[K];
    case 'enum':
      if (!field.options.some((option) => option.value === value)) {
        throw new SettingValueError(key, `must be one of ${field.options.map((option) => option.value).join(', ')}`);
      }
      return value as SettingsValues[K];
    case 'string':
      if (typeof value !== 'string' || value.length > field.maxLength || value.includes('\0')) {
        throw new SettingValueError(key, `must be text of at most ${field.maxLength} characters`);
      }
      return value.trim() as SettingsValues[K];
    case 'appTool':
      return parseAppTool(key, value) as SettingsValues[K];
    case 'gitTool':
      return parseGitTool(key, value) as SettingsValues[K];
  }
}

/** Replicated settings slice. */
export interface SettingsState {
  values: SettingsValues;
  /** Overrides by repository root. */
  repos: Record<string, RepoOverrides>;
  /** Problems found while loading the settings file, shown in Preferences. */
  problems: string[];
}

/** A changed value; `repo` targets that repository's override, `value: null` removes the override. */
export interface SettingsPatch {
  repo?: string;
  values: Partial<Record<SettingKey, unknown>>;
}

/** Programs found on this machine, for the External tools pickers. */
export interface DetectedTools {
  editors: DetectedProgram[];
  terminals: DetectedProgram[];
  /** Tools `git difftool/mergetool --tool-help` reports as available. */
  diffTools: GitToolInfo[];
  mergeTools: GitToolInfo[];
  /** `diff.tool`/`merge.tool` (or their gui variants) from git config, as seen from the repository or home. */
  gitConfig: { diff: string | null; merge: string | null };
}

export interface DetectedProgram {
  id: string;
  /** Resolved executable, or null when not installed. */
  path: string | null;
}

export interface GitToolInfo {
  name: string;
  description: string;
}

/** Commit identity from git config. */
export interface GitIdentity {
  name: string;
  email: string;
}
