// Commands that can have keyboard shortcuts, their default shortcuts per OS, and the shortcut format.
// A shortcut is "Ctrl+Shift+P": modifiers in the order Ctrl, Alt, Shift, Meta, then one key. "Mod" in the
// defaults is Meta (⌘) on macOS and Ctrl elsewhere.

export type KeyPlatform = 'darwin' | 'win32' | 'linux';

export interface CommandInfo {
  id: string;
  title: string;
  category: string;
  /** Default shortcuts; per OS where they differ. */
  keys?: string[] | Partial<Record<KeyPlatform | 'other', string[]>>;
  /** Not listed in the command palette (e.g. "go to tab 3"). */
  hidden?: boolean;
  /** Its shortcut does nothing while typing in a text field or an editor (they keep e.g. their own undo). */
  notInFields?: boolean;
}

const tabCommands: CommandInfo[] = Array.from({ length: 8 }, (_, i) => ({ id: `tabs.select${i + 1}`, title: `Go to tab ${i + 1}`, category: 'Tabs', keys: [`Mod+${i + 1}`], hidden: true }));

export const COMMANDS: readonly CommandInfo[] = [
  { id: 'palette.commands', title: 'Show all commands', category: 'View', keys: ['Mod+Shift+P'] },
  { id: 'palette.find', title: 'Go to file, branch, tag or commit…', category: 'View', keys: ['Mod+P'] },
  { id: 'app.preferences', title: 'Open Preferences', category: 'App', keys: ['Mod+Comma'] },
  { id: 'app.keybindings', title: 'Keyboard shortcuts', category: 'App' },
  { id: 'app.repositories', title: 'Open a repository in a new tab', category: 'Tabs', keys: ['Mod+T'] },
  { id: 'repo.clone', title: 'Clone a repository…', category: 'Repository' },
  { id: 'repo.init', title: 'Create a repository…', category: 'Repository' },
  { id: 'tabs.close', title: 'Close tab', category: 'Tabs', keys: ['Mod+W'] },
  { id: 'tabs.next', title: 'Next tab', category: 'Tabs', keys: ['Ctrl+Tab'] },
  { id: 'tabs.previous', title: 'Previous tab', category: 'Tabs', keys: ['Ctrl+Shift+Tab'] },
  ...tabCommands,
  { id: 'tabs.selectLast', title: 'Go to the last tab', category: 'Tabs', keys: ['Mod+9'], hidden: true },
  { id: 'terminal.toggle', title: 'Show or hide the terminal', category: 'Terminal', keys: ['Ctrl+Backquote'] },
  { id: 'terminal.external', title: 'Open the repository in the external terminal', category: 'Terminal' },
  { id: 'edit.undo', title: 'Undo', category: 'Edit', keys: ['Mod+Z'], notInFields: true },
  { id: 'edit.redo', title: 'Redo', category: 'Edit', keys: { darwin: ['Meta+Shift+Z', 'Meta+Y'], other: ['Ctrl+Shift+Z', 'Ctrl+Y'] }, notInFields: true },
  { id: 'repo.refresh', title: 'Refresh', category: 'Repository' },
  { id: 'repo.fetch', title: 'Fetch all', category: 'Remote', keys: ['Mod+L'] },
  { id: 'repo.pull', title: 'Pull', category: 'Remote' },
  { id: 'repo.pullMerge', title: 'Pull (merge)', category: 'Remote' },
  { id: 'repo.pullRebase', title: 'Pull (rebase)', category: 'Remote' },
  { id: 'repo.push', title: 'Push', category: 'Remote' },
  { id: 'repo.stash', title: 'Stash all changes', category: 'Stash' },
  { id: 'repo.pop', title: 'Pop the latest stash', category: 'Stash' },
  { id: 'repo.stageAll', title: 'Stage all changes', category: 'Changes', keys: ['Mod+Shift+S'] },
  { id: 'repo.unstageAll', title: 'Unstage all changes', category: 'Changes', keys: ['Mod+Shift+U'] },
  { id: 'repo.discardAll', title: 'Discard all changes…', category: 'Changes' },
  { id: 'repo.focusCommit', title: 'Write the commit message', category: 'Changes', keys: ['Mod+Shift+M'] },
  { id: 'repo.createBranch', title: 'Create a branch at HEAD…', category: 'Branches', keys: ['Mod+B'] },
  { id: 'repo.createTag', title: 'Create a tag at HEAD…', category: 'Branches' },
  { id: 'history.search', title: 'Search commits', category: 'History', keys: ['Mod+F'] },
  { id: 'history.goToHead', title: 'Go to HEAD', category: 'History' },
  { id: 'history.showAll', title: 'Show all branches in the graph', category: 'History' },
  { id: 'theme.choose', title: 'Choose a theme…', category: 'View' },
  { id: 'profile.switch', title: 'Switch profile…', category: 'Profiles' },
  { id: 'repo.close', title: 'Close the open view (diff, file history…)', category: 'View', hidden: true },
];

const byId = new Map(COMMANDS.map((command) => [command.id, command]));
export const commandInfo = (id: string): CommandInfo | undefined => byId.get(id);

// --- Shortcut strings ---------------------------------------------------------------------------------

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof MODIFIERS)[number];

// Keys by KeyboardEvent.code, so shortcuts work the same with any keyboard layout (e.g. Cyrillic).
const PUNCTUATION: Record<string, string> = {
  Backquote: 'Backquote',
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
};
const NAMED = ['Enter', 'Escape', 'Tab', 'Space', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right'];
const KEY = /^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Numpad[0-9])$/;

const isKeyName = (key: string) => KEY.test(key) || NAMED.includes(key) || Object.hasOwn(PUNCTUATION, key);

/** The shortcut a key press means, or null for a lone modifier or an unknown key. */
export interface KeyPress {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export function shortcutFromEvent(event: KeyPress): string | null {
  const { code } = event;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = code;
  else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (Object.hasOwn(PUNCTUATION, code)) key = PUNCTUATION[code]!;
  else if (code.startsWith('Arrow')) key = code.slice(5);
  else if (code === 'NumpadEnter') key = 'Enter';
  else if (NAMED.includes(code)) key = code;
  else if (NAMED.includes(event.key)) key = event.key;
  if (!key) return null;
  const mods = MODIFIERS.filter((mod) => event[`${mod.toLowerCase()}Key` as 'ctrlKey']);
  return [...mods, key].join('+');
}

/** Canonical form of a shortcut ("shift+ctrl+p" → "Ctrl+Shift+P"), or null when it is not one. */
export function normalizeShortcut(text: string, platform: KeyPlatform): string | null {
  if (typeof text !== 'string' || text.length > 60) return null;
  const parts = text.split('+').map((part) => part.trim());
  const key = parts.pop();
  if (!key) return null;
  const mods = new Set<Modifier>();
  for (const part of parts) {
    const lower = part.toLowerCase();
    const mod: Modifier | undefined =
      lower === 'mod' ? (platform === 'darwin' ? 'Meta' : 'Ctrl') : lower === 'cmd' || lower === 'meta' ? 'Meta' : lower === 'option' ? 'Alt' : MODIFIERS.find((m) => m.toLowerCase() === lower);
    if (!mod || mods.has(mod)) return null;
    mods.add(mod);
  }
  const canonical = keyAlias(key);
  if (!isKeyName(canonical)) return null;
  return [...MODIFIERS.filter((mod) => mods.has(mod)), canonical].join('+');
}

function keyAlias(key: string): string {
  const fromLabel = Object.entries(KEY_LABELS).find(([, label]) => label === key)?.[0];
  if (fromLabel) return fromLabel;
  if (key.length === 1) return key.toUpperCase();
  const lower = key.toLowerCase().replace(/^arrow/, '');
  if (lower === 'esc') return 'Escape';
  return [...NAMED, ...Object.keys(PUNCTUATION)].find((name) => name.toLowerCase() === lower) ?? (/^f\d+$/.test(lower) ? lower.toUpperCase() : key);
}

/** The default shortcuts of a command on this OS, in canonical form. */
export function defaultShortcuts(command: CommandInfo, platform: KeyPlatform): string[] {
  const keys = Array.isArray(command.keys) ? command.keys : command.keys ? (command.keys[platform] ?? command.keys.other ?? []) : [];
  return keys.map((key) => normalizeShortcut(key, platform)!);
}

/** User overrides (command id → its shortcuts; [] removes them all), as stored in the settings. */
export type KeybindingOverrides = Record<string, string[]>;

/** Every command's shortcuts with the overrides applied. */
export function effectiveShortcuts(overrides: KeybindingOverrides, platform: KeyPlatform): Map<string, string[]> {
  return new Map(COMMANDS.map((command) => [command.id, overrides[command.id] ?? defaultShortcuts(command, platform)]));
}

/** Shortcut → the command it runs. */
export function shortcutIndex(shortcuts: Map<string, string[]>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [id, keys] of shortcuts) for (const key of keys) if (!index.has(key)) index.set(key, id);
  return index;
}

export const MAX_SHORTCUTS = 4;

/** Validates overrides from a window (untrusted). */
export function parseKeybindingOverrides(value: unknown): KeybindingOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Shortcuts must be an object');
  const entries = Object.entries(value);
  if (entries.length > COMMANDS.length) throw new TypeError('Too many shortcut entries');
  const result: KeybindingOverrides = {};
  const used = new Map<string, string>();
  for (const [id, keys] of entries) {
    if (!byId.has(id)) throw new TypeError(`Unknown command "${id}"`);
    if (!Array.isArray(keys) || keys.length > MAX_SHORTCUTS) throw new TypeError(`Shortcuts of "${id}" must be a list of up to ${MAX_SHORTCUTS}`);
    // Stored canonical; validity does not depend on the OS ("Mod" is not stored).
    result[id] = keys.map((key) => {
      const canonical = typeof key === 'string' && !/\bmod\b/i.test(key) ? normalizeShortcut(key, 'linux') : null;
      if (!canonical || canonical !== key) throw new TypeError(`"${String(key)}" is not a shortcut`);
      if (used.has(key)) throw new TypeError(`${key} is set for both "${used.get(key)}" and "${id}"`);
      used.set(key, id);
      return key;
    });
  }
  return result;
}

const MAC_SYMBOLS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
const KEY_LABELS: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Escape: 'Esc',
};

/** How a shortcut is shown: "⇧⌘P" on macOS, "Ctrl+Shift+P" elsewhere. */
export function formatShortcut(shortcut: string, platform: KeyPlatform | string): string {
  const parts = shortcut.split('+');
  const key = parts.pop()!;
  const label = KEY_LABELS[key] ?? key;
  if (platform === 'darwin') {
    // macOS order: ⌃⌥⇧⌘.
    return `${parts.map((mod) => MAC_SYMBOLS[mod] ?? mod).join('')}${label}`;
  }
  return [...parts.map((mod) => (mod === 'Meta' ? (platform === 'win32' ? 'Win' : 'Super') : mod)), label].join('+');
}

export const keyPlatform = (platform: string): KeyPlatform => (platform === 'darwin' || platform === 'win32' ? platform : 'linux');
