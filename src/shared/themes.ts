import { THEME_PALETTES, type ThemePalette } from './themePalettes';

// Color themes: the tokens every theme defines (CSS variables of the same name), the built-in themes,
// user themes (JSONC files extending a built-in one) and the contrast rules the built-in themes meet.

export const THEME_TOKEN_GROUPS = {
  surfaces: ['bg', 'bg-panel', 'bg-raised', 'bg-input', 'bg-hover', 'border', 'border-strong', 'selection', 'overlay', 'shadow'],
  text: ['fg', 'fg-muted', 'fg-dimmed', 'fg-bright', 'fg-inverse'],
  accent: ['accent', 'focus', 'primary-bg', 'primary-fg'],
  status: ['success', 'warning', 'danger-fg', 'danger-bg', 'danger-solid', 'danger-solid-fg'],
  refs: ['ref-bg', 'tag-bg'],
  graph: ['graph-0', 'graph-1', 'graph-2', 'graph-3', 'graph-4', 'graph-5', 'graph-6', 'graph-7', 'graph-8', 'graph-9'],
  stats: ['stat-added', 'stat-removed', 'stat-modified'],
  diff: ['diff-added-bg', 'diff-removed-bg', 'diff-changed-bg'],
  conflicts: ['conflict-ours', 'conflict-theirs', 'conflict-base', 'conflict-marker'],
  controls: ['button-bg', 'button-border', 'input-border', 'scrollbar', 'scrollbar-hover'],
  toolbar: ['toolbar-bg', 'toolbar-hover'],
  code: ['code-bg', 'code-fg', 'code-line-number', 'code-selection', 'code-comment', 'code-keyword', 'code-string', 'code-number', 'code-type', 'code-tag', 'blame'],
} as const;

export type ThemeToken = (typeof THEME_TOKEN_GROUPS)[keyof typeof THEME_TOKEN_GROUPS][number];
export const THEME_TOKENS = Object.values(THEME_TOKEN_GROUPS).flat() as ThemeToken[];
export type ThemeTokens = Record<ThemeToken, string>;

export type ThemeScheme = 'light' | 'dark';

export interface Theme {
  /** Built-in: its key; user theme: "user:<file name without .jsonc>". */
  id: string;
  name: string;
  scheme: ThemeScheme;
  highContrast: boolean;
  tokens: ThemeTokens;
}

/** A user theme file that could not be used. */
export interface ThemeProblem {
  file: string;
  message: string;
}

/** User themes found in userData/themes (replicated). */
export interface UserThemesState {
  folder: string;
  themes: Theme[];
  problems: ThemeProblem[];
}

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const isThemeColor = (value: unknown): value is string => typeof value === 'string' && COLOR.test(value);

// Translucent tints shared by the themes of one scheme.
const darkTints = {
  overlay: '#00000080',
  shadow: '#00000099',
  'diff-added-bg': '#2ea04333',
  'diff-removed-bg': '#e5534b33',
  'diff-changed-bg': '#4f8df52e',
  'conflict-ours': '#2ea04330',
  'conflict-theirs': '#4f8df530',
  'conflict-base': '#8b949e2b',
  'conflict-marker': '#e5a50a3d',
} as const;

const lightTints = {
  overlay: '#0f172a59',
  shadow: '#0f172a40',
  'diff-added-bg': '#2ea04324',
  'diff-removed-bg': '#dc354524',
  'diff-changed-bg': '#2f6fde21',
  'conflict-ours': '#2ea0432e',
  'conflict-theirs': '#2f6fde2e',
  'conflict-base': '#80808026',
  'conflict-marker': '#e5a50a38',
} as const;

const forkliftDark: ThemeTokens = {
  ...darkTints,
  bg: '#1c2029',
  'bg-panel': '#232834',
  'bg-raised': '#2a303d',
  'bg-input': '#171a22',
  'bg-hover': '#2e3545',
  border: '#363d4c',
  'border-strong': '#56607a',
  selection: '#2b3d60',
  fg: '#e3e7ee',
  'fg-muted': '#aab2c0',
  'fg-dimmed': '#959eb0',
  'fg-bright': '#ffffff',
  'fg-inverse': '#1c2029',
  accent: '#6aa6ff',
  focus: '#6aa6ff',
  'primary-bg': '#3a73d6',
  'primary-fg': '#ffffff',
  success: '#5fcf80',
  warning: '#e8b955',
  'danger-fg': '#ff9393',
  'danger-bg': '#4a2328',
  'danger-solid': '#c73a3a',
  'danger-solid-fg': '#ffffff',
  'ref-bg': '#26395c',
  'tag-bg': '#4a3c19',
  'graph-0': '#5b9bf5',
  'graph-1': '#ff8a4c',
  'graph-2': '#51cf66',
  'graph-3': '#da77f2',
  'graph-4': '#ffc078',
  'graph-5': '#3bc9db',
  'graph-6': '#f783ac',
  'graph-7': '#9775fa',
  'graph-8': '#a9e34b',
  'graph-9': '#74c0fc',
  'stat-added': '#5fcf80',
  'stat-removed': '#ff8080',
  'stat-modified': '#e8b955',
  'toolbar-bg': '#272c38',
  'toolbar-hover': '#1e222b',
  'button-bg': '#2a303d',
  'button-border': '#3d4556',
  'input-border': '#414a5c',
  scrollbar: '#56607a80',
  'scrollbar-hover': '#6b7794b3',
  'code-bg': '#1a1e26',
  'code-fg': '#dae0ea',
  'code-line-number': '#838da2',
  'code-selection': '#2f4570',
  'code-comment': '#8f99ac',
  'code-keyword': '#c99af0',
  'code-string': '#9fd8a4',
  'code-number': '#f5ad73',
  'code-type': '#6ec6f5',
  'code-tag': '#ff9393',
  blame: '#6aa6ff',
};

const forkliftLight: ThemeTokens = {
  ...lightTints,
  bg: '#ffffff',
  'bg-panel': '#f3f5f8',
  'bg-raised': '#ffffff',
  'bg-input': '#ffffff',
  'bg-hover': '#e9edf3',
  border: '#dde2ea',
  'border-strong': '#97a1b1',
  selection: '#d8e5fb',
  fg: '#1b2230',
  'fg-muted': '#545e6e',
  'fg-dimmed': '#656e7e',
  'fg-bright': '#000000',
  'fg-inverse': '#ffffff',
  accent: '#2361c6',
  focus: '#2361c6',
  'primary-bg': '#2361c6',
  'primary-fg': '#ffffff',
  success: '#1d7638',
  warning: '#875700',
  'danger-fg': '#b02222',
  'danger-bg': '#fdecec',
  'danger-solid': '#c02929',
  'danger-solid-fg': '#ffffff',
  'ref-bg': '#e1ebfb',
  'tag-bg': '#fbefd2',
  'graph-0': '#2f6fde',
  'graph-1': '#d9480f',
  'graph-2': '#2b8a3e',
  'graph-3': '#ae3ec9',
  'graph-4': '#c25e00',
  'graph-5': '#0c8599',
  'graph-6': '#c2255c',
  'graph-7': '#5f3dc4',
  'graph-8': '#5c940d',
  'graph-9': '#1971c2',
  'stat-added': '#1d7638',
  'stat-removed': '#b02222',
  'stat-modified': '#875700',
  'toolbar-bg': '#eef1f5',
  'toolbar-hover': '#e0e6ee',
  'button-bg': '#f3f5f8',
  'button-border': '#d3d9e2',
  'input-border': '#c9d0db',
  scrollbar: '#97a1b166',
  'scrollbar-hover': '#7a8598a6',
  'code-bg': '#ffffff',
  'code-fg': '#1b2230',
  'code-line-number': '#656e7e',
  'code-selection': '#cfe0fb',
  'code-comment': '#5f6b7b',
  'code-keyword': '#7628b5',
  'code-string': '#1b7536',
  'code-number': '#9c4700',
  'code-type': '#0b62a3',
  'code-tag': '#b02222',
  blame: '#2361c6',
};

const darkHighContrast: ThemeTokens = {
  ...darkTints,
  overlay: '#000000b3',
  'diff-added-bg': '#2ea04359',
  'diff-removed-bg': '#e5534b59',
  'diff-changed-bg': '#4f8df54d',
  bg: '#000000',
  'bg-panel': '#0b0b0b',
  'bg-raised': '#121212',
  'bg-input': '#000000',
  'bg-hover': '#1f1f1f',
  border: '#7a7a7a',
  'border-strong': '#ffffff',
  selection: '#0a3d7a',
  fg: '#ffffff',
  'fg-muted': '#e6e6e6',
  'fg-dimmed': '#cccccc',
  'fg-bright': '#ffffff',
  'fg-inverse': '#000000',
  accent: '#7cc0ff',
  focus: '#ffd84a',
  'primary-bg': '#7cc0ff',
  'primary-fg': '#000000',
  success: '#66f28f',
  warning: '#ffd84a',
  'danger-fg': '#ffa3a3',
  'danger-bg': '#3d0000',
  'danger-solid': '#ff8080',
  'danger-solid-fg': '#000000',
  'ref-bg': '#002a5c',
  'tag-bg': '#3d2c00',
  'graph-0': '#7cc0ff',
  'graph-1': '#ff9e5e',
  'graph-2': '#66f28f',
  'graph-3': '#f09cff',
  'graph-4': '#ffd84a',
  'graph-5': '#5ee6f5',
  'graph-6': '#ff9ec4',
  'graph-7': '#b9a3ff',
  'graph-8': '#c6f27a',
  'graph-9': '#a8dcff',
  'stat-added': '#66f28f',
  'stat-removed': '#ffa3a3',
  'stat-modified': '#ffd84a',
  'toolbar-bg': '#0b0b0b',
  'toolbar-hover': '#262626',
  'button-bg': '#121212',
  'button-border': '#a0a0a0',
  'input-border': '#a0a0a0',
  scrollbar: '#ffffff66',
  'scrollbar-hover': '#ffffffa6',
  'code-bg': '#000000',
  'code-fg': '#ffffff',
  'code-line-number': '#d0d0d0',
  'code-selection': '#0a3d7a',
  'code-comment': '#c8d4c0',
  'code-keyword': '#e0b3ff',
  'code-string': '#a6f5b0',
  'code-number': '#ffc48a',
  'code-type': '#8fd3ff',
  'code-tag': '#ffa3a3',
  blame: '#7cc0ff',
};

const lightHighContrast: ThemeTokens = {
  ...lightTints,
  overlay: '#00000080',
  'diff-added-bg': '#2ea04340',
  'diff-removed-bg': '#dc354538',
  'diff-changed-bg': '#2f6fde33',
  bg: '#ffffff',
  'bg-panel': '#f6f6f6',
  'bg-raised': '#ffffff',
  'bg-input': '#ffffff',
  'bg-hover': '#e8e8e8',
  border: '#6e6e6e',
  'border-strong': '#000000',
  selection: '#cce0ff',
  fg: '#000000',
  'fg-muted': '#262626',
  'fg-dimmed': '#3a3a3a',
  'fg-bright': '#000000',
  'fg-inverse': '#ffffff',
  accent: '#0040a8',
  focus: '#0040a8',
  'primary-bg': '#0040a8',
  'primary-fg': '#ffffff',
  success: '#00561b',
  warning: '#633f00',
  'danger-fg': '#9e0000',
  'danger-bg': '#ffe8e8',
  'danger-solid': '#9e0000',
  'danger-solid-fg': '#ffffff',
  'ref-bg': '#dde9ff',
  'tag-bg': '#fff1c7',
  'graph-0': '#0040a8',
  'graph-1': '#b33a00',
  'graph-2': '#00691f',
  'graph-3': '#8a1fa8',
  'graph-4': '#8f5200',
  'graph-5': '#006775',
  'graph-6': '#a3134a',
  'graph-7': '#4a26b0',
  'graph-8': '#3f6b00',
  'graph-9': '#00589c',
  'stat-added': '#00561b',
  'stat-removed': '#9e0000',
  'stat-modified': '#633f00',
  'toolbar-bg': '#f2f2f2',
  'toolbar-hover': '#dcdcdc',
  'button-bg': '#f6f6f6',
  'button-border': '#555555',
  'input-border': '#555555',
  scrollbar: '#00000059',
  'scrollbar-hover': '#00000099',
  'code-bg': '#ffffff',
  'code-fg': '#000000',
  'code-line-number': '#3a3a3a',
  'code-selection': '#c2d9ff',
  'code-comment': '#3f4a3a',
  'code-keyword': '#5a0f8f',
  'code-string': '#00561b',
  'code-number': '#7a3500',
  'code-type': '#004a85',
  'code-tag': '#9e0000',
  blame: '#0040a8',
};

// Cold northern colors: frost blues on slate.
const polar: ThemeTokens = {
  ...darkTints,
  'diff-added-bg': '#a3be8c33',
  'diff-removed-bg': '#d0757e33',
  'diff-changed-bg': '#88c0d02e',
  bg: '#2b303b',
  'bg-panel': '#313744',
  'bg-raised': '#39404e',
  'bg-input': '#262a33',
  'bg-hover': '#3c4453',
  border: '#464e5e',
  'border-strong': '#6b768b',
  selection: '#3e5172',
  fg: '#eceff4',
  'fg-muted': '#c9d0dc',
  'fg-dimmed': '#b2bbca',
  'fg-bright': '#ffffff',
  'fg-inverse': '#2b303b',
  accent: '#8fc8d8',
  focus: '#8fc8d8',
  'primary-bg': '#8fc8d8',
  'primary-fg': '#1d2129',
  success: '#b3cf9b',
  warning: '#ecd197',
  'danger-fg': '#f0a8ae',
  'danger-bg': '#4d3239',
  'danger-solid': '#e0939a',
  'danger-solid-fg': '#1d2129',
  'ref-bg': '#3b4d66',
  'tag-bg': '#56492f',
  'graph-0': '#8fc8d8',
  'graph-1': '#d99b82',
  'graph-2': '#b3cf9b',
  'graph-3': '#c4a3c4',
  'graph-4': '#ecd197',
  'graph-5': '#8fbcbb',
  'graph-6': '#e0939a',
  'graph-7': '#9fb3e0',
  'graph-8': '#c9dc8a',
  'graph-9': '#81a8d4',
  'stat-added': '#b3cf9b',
  'stat-removed': '#f0a8ae',
  'stat-modified': '#ecd197',
  'toolbar-bg': '#343a47',
  'toolbar-hover': '#2a2f3a',
  'button-bg': '#39404e',
  'button-border': '#4e5769',
  'input-border': '#525b6e',
  scrollbar: '#6b768b80',
  'scrollbar-hover': '#8590a6b3',
  'code-bg': '#2b303b',
  'code-fg': '#e5e9f0',
  'code-line-number': '#a0aabb',
  'code-selection': '#435675',
  'code-comment': '#a3adbf',
  'code-keyword': '#9fc2e8',
  'code-string': '#b3cf9b',
  'code-number': '#d4a8cc',
  'code-type': '#8fc8d8',
  'code-tag': '#e7a28a',
  blame: '#8fc8d8',
};

// Warm, low-contrast paper tones.
const sand: ThemeTokens = {
  ...lightTints,
  overlay: '#2b211459',
  shadow: '#2b211440',
  'diff-added-bg': '#7a9a2a2e',
  'diff-removed-bg': '#c2522e2b',
  'diff-changed-bg': '#c0802a29',
  'conflict-ours': '#7a9a2a33',
  'conflict-theirs': '#3f7aa333',
  'conflict-base': '#8a7a6029',
  'conflict-marker': '#d99a1a40',
  bg: '#f6f0e4',
  'bg-panel': '#ede5d5',
  'bg-raised': '#faf6ee',
  'bg-input': '#fbf8f2',
  'bg-hover': '#e6dcc9',
  border: '#d9cdb6',
  'border-strong': '#a8977a',
  selection: '#e8d7b3',
  fg: '#3d3326',
  'fg-muted': '#5e5242',
  'fg-dimmed': '#6b5e4c',
  'fg-bright': '#241d14',
  'fg-inverse': '#f6f0e4',
  accent: '#8a4f17',
  focus: '#8a4f17',
  'primary-bg': '#8a4f17',
  'primary-fg': '#ffffff',
  success: '#4a651c',
  warning: '#7d5300',
  'danger-fg': '#9c321d',
  'danger-bg': '#f5ddd1',
  'danger-solid': '#9c321d',
  'danger-solid-fg': '#ffffff',
  'ref-bg': '#e8dcc0',
  'tag-bg': '#efdcaa',
  'graph-0': '#a0571a',
  'graph-1': '#3f7aa3',
  'graph-2': '#5d7d22',
  'graph-3': '#9a4a7a',
  'graph-4': '#b07a00',
  'graph-5': '#2f8077',
  'graph-6': '#b24a3a',
  'graph-7': '#6a5aa0',
  'graph-8': '#7d7a1a',
  'graph-9': '#4f6f9a',
  'stat-added': '#4a651c',
  'stat-removed': '#9c321d',
  'stat-modified': '#7d5300',
  'toolbar-bg': '#ece3d1',
  'toolbar-hover': '#e0d5bf',
  'button-bg': '#ede5d5',
  'button-border': '#d2c5ab',
  'input-border': '#cbbd9f',
  scrollbar: '#a8977a66',
  'scrollbar-hover': '#8f7f63a6',
  'code-bg': '#faf6ee',
  'code-fg': '#3d3326',
  'code-line-number': '#6b5e4c',
  'code-selection': '#ead9b5',
  'code-comment': '#6a6050',
  'code-keyword': '#8a3f6a',
  'code-string': '#4a651c',
  'code-number': '#9a4a12',
  'code-type': '#2f6a8a',
  'code-tag': '#9c321d',
  blame: '#a0571a',
};

const builtin = (id: string, name: string, scheme: ThemeScheme, highContrast: boolean, tokens: ThemeTokens): Theme => ({ id, name, scheme, highContrast, tokens });

export const BUILTIN_THEMES: readonly Theme[] = [
  builtin('forklift-dark', 'Forklift Dark', 'dark', false, forkliftDark),
  builtin('forklift-light', 'Forklift Light', 'light', false, forkliftLight),
  builtin('dark-high-contrast', 'Dark High Contrast', 'dark', true, darkHighContrast),
  builtin('light-high-contrast', 'Light High Contrast', 'light', true, lightHighContrast),
  builtin('polar', 'Polar', 'dark', false, polar),
  builtin('sand', 'Sand', 'light', false, sand),
  ...THEME_PALETTES.map((palette) => builtin(palette.id, palette.name, palette.scheme, false, paletteTheme(palette))),
];

/** Setting values meaning "follow the system's light/dark" (app) and "same as the app" (editor). */
export const SYSTEM_THEME = 'system';
export const APP_THEME = 'app';

const builtinById = (id: string) => BUILTIN_THEMES.find((theme) => theme.id === id);

/** The theme a setting value names; unknown (e.g. a deleted user theme) falls back to the system default. */
export function resolveTheme(id: string, systemDark: boolean, user: readonly Theme[] = []): Theme {
  if (id !== SYSTEM_THEME) {
    const found = builtinById(id) ?? user.find((theme) => theme.id === id);
    if (found) return found;
  }
  return builtinById(systemDark ? 'forklift-dark' : 'forklift-light')!;
}

/** Valid shape of a theme setting value (whether the theme exists is checked separately). */
export const THEME_ID = /^(?:[a-z0-9-]{1,64}|user:[\w .-]{1,100})$/;

// --- User theme files -------------------------------------------------------------------------------

/** JSON with comments and trailing commas. */
export function parseJsonc(text: string): unknown {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new SyntaxError('Unterminated /* comment');
      // Keep line breaks so positions in errors still match.
      out += text.slice(i, end + 2).replace(/[^\n]/g, ' ');
      i = end + 1;
    } else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * A user theme from its file: `{ meta: { name, scheme?, extends? }, tokens: { … } }`. `extends` names a
 * built-in theme (default: Forklift Dark or Light by `scheme`); `tokens` override some of its colors.
 */
export function parseUserTheme(fileStem: string, text: string): Theme {
  let data: unknown;
  try {
    data = parseJsonc(text);
  } catch (error) {
    throw new Error(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('The file must contain an object with "meta" and "tokens"');
  const { meta, tokens } = data as Record<string, unknown>;
  if (typeof meta !== 'object' || meta === null) throw new Error('"meta" is missing');
  const { name, scheme, extends: base } = meta as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('"meta.name" must be a name of up to 80 characters');
  if (scheme !== undefined && scheme !== 'light' && scheme !== 'dark') throw new Error('"meta.scheme" must be "light" or "dark"');
  if (base !== undefined && (typeof base !== 'string' || !builtinById(base))) {
    throw new Error(`"meta.extends" must be one of: ${BUILTIN_THEMES.map((theme) => theme.id).join(', ')}`);
  }
  const parent = builtinById((base as string | undefined) ?? (scheme === 'light' ? 'forklift-light' : 'forklift-dark'))!;
  const overrides: Partial<ThemeTokens> = {};
  if (tokens !== undefined) {
    if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) throw new Error('"tokens" must be an object');
    for (const [key, value] of Object.entries(tokens)) {
      if (!(THEME_TOKENS as string[]).includes(key)) throw new Error(`Unknown token "${key}"`);
      if (!isThemeColor(value)) throw new Error(`"${key}" must be a color like #1e90ff or #1e90ff80`);
      overrides[key as ThemeToken] = value;
    }
  }
  return {
    id: `user:${fileStem}`,
    name: name.trim(),
    scheme: (scheme as ThemeScheme | undefined) ?? parent.scheme,
    highContrast: parent.highContrast,
    tokens: { ...parent.tokens, ...overrides },
  };
}

// --- Contrast (WCAG 2) --------------------------------------------------------------------------------

type Rgba = [number, number, number, number];

export function parseColor(color: string): Rgba {
  let hex = color.slice(1);
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const value = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [value(0), value(2), value(4), hex.length === 8 ? value(6) / 255 : 1];
}

/** `color` painted over the opaque `under`. */
function over(color: string, under: string): Rgba {
  const [r, g, b, a] = parseColor(color);
  const [ur, ug, ub] = parseColor(under);
  return [r * a + ur * (1 - a), g * a + ug * (1 - a), b * a + ub * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio of `fg` on `bg` (a translucent `bg` is painted over `base`). */
export function contrastRatio(fg: string, bg: string, base = '#ffffff'): number {
  const background = over(bg, base);
  const hex = `#${background
    .slice(0, 3)
    .map((c) => Math.round(c).toString(16).padStart(2, '0'))
    .join('')}`;
  const [l1, l2] = [luminance(over(fg, hex)), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

export interface ContrastPair {
  fg: ThemeToken;
  bg: ThemeToken;
  /** For translucent backgrounds: what they are painted over. */
  base?: ThemeToken;
  /** Not text (graph lines, focus rings): WCAG asks 3:1. */
  graphic?: boolean;
}

const TEXT = ['fg', 'fg-muted', 'fg-dimmed', 'fg-bright', 'accent', 'success', 'warning', 'danger-fg', 'stat-added', 'stat-removed', 'stat-modified'] as const;
const SURFACES = ['bg', 'bg-panel', 'bg-raised', 'bg-input', 'toolbar-bg'] as const;
const CODE_TEXT = ['code-fg', 'code-line-number', 'code-comment', 'code-keyword', 'code-string', 'code-number', 'code-type', 'code-tag'] as const;

/** Text/background pairs that must stay readable in every built-in theme. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...TEXT.flatMap((fg) => SURFACES.map((bg) => ({ fg, bg }))),
  // Hovered: only enabled controls (fg and fg-muted text) light up.
  ...(['fg', 'fg-muted'] as const).flatMap((fg) => (['selection', 'bg-hover', 'toolbar-hover'] as const).map((bg) => ({ fg, bg }))),
  { fg: 'fg', bg: 'ref-bg' },
  { fg: 'fg', bg: 'tag-bg' },
  { fg: 'fg', bg: 'button-bg' },
  { fg: 'primary-fg', bg: 'primary-bg' },
  { fg: 'danger-solid-fg', bg: 'danger-solid' },
  { fg: 'danger-fg', bg: 'danger-bg' },
  { fg: 'fg-inverse', bg: 'fg' },
  { fg: 'fg', bg: 'diff-added-bg', base: 'bg' },
  { fg: 'fg', bg: 'diff-removed-bg', base: 'bg' },
  ...CODE_TEXT.map((fg) => ({ fg, bg: 'code-bg' as const })),
  { fg: 'code-fg', bg: 'code-selection' },
  ...(['diff-added-bg', 'diff-removed-bg', 'diff-changed-bg', 'conflict-ours', 'conflict-theirs', 'conflict-base', 'conflict-marker'] as const).map((bg) => ({
    fg: 'code-fg' as const,
    bg,
    base: 'code-bg' as const,
  })),
  ...THEME_TOKEN_GROUPS.graph.map((fg) => ({ fg, bg: 'bg' as const, graphic: true })),
  { fg: 'focus', bg: 'bg', graphic: true },
];

/** Pairs below the minimum: 7:1 (4.5:1 normal themes) for text, 3:1 for graphics. */
export function contrastProblems(theme: Theme): Array<ContrastPair & { ratio: number; minimum: number }> {
  return CONTRAST_PAIRS.flatMap((pair) => {
    const minimum = pair.graphic ? 3 : theme.highContrast ? 7 : 4.5;
    const ratio = contrastRatio(theme.tokens[pair.fg], theme.tokens[pair.bg], pair.base ? theme.tokens[pair.base] : theme.tokens.bg);
    return ratio < minimum ? [{ ...pair, ratio: Math.round(ratio * 100) / 100, minimum }] : [];
  });
}

// --- Themes from palettes and accent colors --------------------------------------------------------------

type Hsl = [h: number, s: number, l: number];

function toHsl(color: string): Hsl {
  const [r, g, b] = parseColor(color).map((c, i) => (i < 3 ? c / 255 : c)) as Rgba;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function fromHsl([h, s, l]: Hsl): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** `a` and `b` mixed, `weight` of `a` (opaque colors). */
function mix(a: string, b: string, weight: number): string {
  const [ar, ag, ab] = parseColor(a);
  const [br, bg, bb] = parseColor(b);
  const channel = (x: number, y: number) =>
    Math.round(x * weight + y * (1 - weight))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

/** A translucent color as it looks over `base`. */
function flatten(color: string, base: string): string {
  return `#${over(color, base)
    .slice(0, 3)
    .map((c) => Math.round(c).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * `color`, made lighter (toward white) or darker until it reads at `minimum` on every one of `backgrounds`; the
 * hue and saturation stay, so a palette keeps its character.
 */
function readable(color: string, backgrounds: readonly string[], minimum: number, toward: 'lighter' | 'darker'): string {
  const [h, s, l] = toHsl(color);
  for (let step = 0; step <= 100; step++) {
    const lightness = toward === 'lighter' ? Math.min(100, l + step) : Math.max(0, l - step);
    const candidate = fromHsl([h, s, lightness]);
    if (backgrounds.every((background) => contrastRatio(candidate, background) >= minimum)) return candidate;
  }
  return toward === 'lighter' ? '#ffffff' : '#000000';
}

/**
 * Lane colors: a ten-step wheel (AngKorGit's), lighter on dark themes, darker on light ones. A function: the
 * built-in themes are made from it before the module's constants below them exist.
 */
function laneHues(): readonly Hsl[] {
  return [
    [32, 93, 54],
    [199, 89, 48],
    [142, 71, 45],
    [262, 83, 66],
    [0, 84, 60],
    [174, 62, 47],
    [43, 96, 56],
    [292, 84, 61],
    [217, 91, 60],
    [24, 94, 50],
  ];
}

/** Every token of a theme from its palette; text colors are nudged until they meet the contrast rules. */
function paletteTheme(palette: ThemePalette): ThemeTokens {
  const dark = palette.scheme === 'dark';
  const toward = dark ? 'lighter' : 'darker';
  const tints = dark ? darkTints : lightTints;
  const bg = palette.background;
  const panel = palette.surface;
  const raised = palette.raised;
  const input = dark ? mix(palette.background, '#000000', 0.8) : '#ffffff';
  const hover = mix(palette.foreground, panel, 0.08);
  const toolbarHover = mix(palette.foreground, panel, 0.12);
  const surfaces = [bg, panel, raised, input, panel];
  const accentBase = palette[palette.accent];
  const selection = mix(accentBase, bg, 0.24);
  const warningBase = dark ? '#d29922' : '#9a6700';
  const refBg = mix(accentBase, panel, 0.2);
  const tagBg = mix(warningBase, panel, 0.2);
  const busy = [...surfaces, selection, hover, toolbarHover, refBg, tagBg, flatten(tints['diff-added-bg'], bg), flatten(tints['diff-removed-bg'], bg)];
  const fg = readable(palette.foreground, busy, 4.5, toward);
  const text = (color: string) => readable(color, surfaces, 4.5, toward);
  const accent = readable(accentBase, surfaces, 4.5, toward);
  const primaryFg = luminance(parseColor(accentBase)) > 0.3 ? '#000000' : '#ffffff';
  const primaryBg = readable(accentBase, [primaryFg], 4.5, primaryFg === '#ffffff' ? 'darker' : 'lighter');
  const dangerBg = mix(dark ? '#f85149' : '#cf222e', bg, 0.16);
  const codeBg = bg;
  const codeSelection = mix(accentBase, codeBg, 0.3);
  const codeBackgrounds = [
    codeBg,
    codeSelection,
    ...(['diff-added-bg', 'diff-removed-bg', 'diff-changed-bg', 'conflict-ours', 'conflict-theirs', 'conflict-base', 'conflict-marker'] as const).map((tint) => flatten(tints[tint], codeBg)),
  ];
  const code = (color: string) => readable(color, [codeBg], 4.5, toward);
  const success = text(dark ? '#3fb950' : '#1a7f37');
  const warning = text(warningBase);
  const dangerFg = readable(dark ? '#f85149' : '#cf222e', [...surfaces, dangerBg], 4.5, toward);
  const lane = (i: number) => {
    const [h, s, l] = laneHues()[i]!;
    return readable(fromHsl([h, s, dark ? Math.max(l, 58) : Math.min(l, 42)]), [bg], 3, toward);
  };
  const borderStrong = mix(palette.foreground, palette.border, 0.35);
  return {
    ...tints,
    bg,
    'bg-panel': panel,
    'bg-raised': raised,
    'bg-input': input,
    'bg-hover': hover,
    border: palette.border,
    'border-strong': borderStrong,
    selection,
    fg,
    'fg-muted': readable(palette.muted, busy.slice(0, surfaces.length + 3), 4.5, toward),
    'fg-dimmed': text(palette.faint),
    'fg-bright': dark ? '#ffffff' : '#000000',
    'fg-inverse': bg,
    accent,
    focus: readable(accentBase, [bg], 3, toward),
    'primary-bg': primaryBg,
    'primary-fg': primaryFg,
    success,
    warning,
    'danger-fg': dangerFg,
    'danger-bg': dangerBg,
    'danger-solid': readable(dark ? '#da3633' : '#cf222e', ['#ffffff'], 4.5, 'darker'),
    'danger-solid-fg': '#ffffff',
    'ref-bg': refBg,
    'tag-bg': tagBg,
    ...(Object.fromEntries(laneHues().map((_, i) => [`graph-${i}`, lane(i)])) as Record<`graph-${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`, string>),
    'stat-added': success,
    'stat-removed': dangerFg,
    'stat-modified': warning,
    'toolbar-bg': panel,
    'toolbar-hover': toolbarHover,
    'button-bg': raised,
    'button-border': palette.border,
    'input-border': mix(palette.foreground, palette.border, 0.15),
    scrollbar: `${borderStrong}80`,
    'scrollbar-hover': `${palette.muted}b3`,
    'code-bg': codeBg,
    'code-fg': readable(palette.foreground, codeBackgrounds, 4.5, toward),
    'code-line-number': code(palette.faint),
    'code-selection': codeSelection,
    'code-comment': code(palette.faint),
    'code-keyword': code(palette.keyword),
    'code-string': code(palette.string),
    'code-number': code(palette.number),
    'code-type': code(palette.type),
    'code-tag': code(palette.variable),
    blame: accent,
  };
}

/** Accent colors to choose from in Preferences (`ui.accent`); 'theme' keeps the theme's own. */
export const ACCENTS = {
  blue: '#3b82f6',
  green: '#10b981',
  purple: '#8b5cf6',
  pink: '#ec4899',
  red: '#ef4444',
  orange: '#f97316',
  gold: '#d97706',
  teal: '#14b8a6',
} as const;
export type AccentId = keyof typeof ACCENTS;

/**
 * The theme with another accent: buttons, links, focus rings and blame take it (nudged until readable on the
 * theme's surfaces); lanes, selection and diff colors keep their meaning.
 */
export function withAccent(theme: Theme, accentId: string): Theme {
  if (!Object.hasOwn(ACCENTS, accentId)) return theme;
  const base = ACCENTS[accentId as AccentId];
  const tokens = theme.tokens;
  const toward = theme.scheme === 'dark' ? 'lighter' : 'darker';
  const minimum = theme.highContrast ? 7 : 4.5;
  const accent = readable(base, [tokens.bg, tokens['bg-panel'], tokens['bg-raised'], tokens['bg-input'], tokens['toolbar-bg']], minimum, toward);
  const primaryFg = luminance(parseColor(base)) > 0.3 ? '#000000' : '#ffffff';
  return {
    ...theme,
    tokens: {
      ...tokens,
      accent,
      focus: readable(base, [tokens.bg], 3, toward),
      'primary-bg': readable(base, [primaryFg], minimum, primaryFg === '#ffffff' ? 'darker' : 'lighter'),
      'primary-fg': primaryFg,
      blame: accent,
    },
  };
}
