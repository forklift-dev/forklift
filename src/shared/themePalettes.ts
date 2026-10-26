// Palettes of the built-in themes made from popular editor themes, as AngKorGit publishes them
// (packages/design-system/src/themes.css, MIT, see THIRD_PARTY_NOTICES.md), converted from HSL. Each is the
// neutrals and syntax colors of a theme; `themes.ts` derives every token from it (paletteTheme) and nudges the
// colors that must be readable until they are. The names are our own.

export interface ThemePalette {
  id: string;
  name: string;
  scheme: 'light' | 'dark';
  /** The app background (the deepest surface). */
  background: string;
  /** Panels. */
  surface: string;
  raised: string;
  /** Hovered rows and popups. */
  overlay: string;
  border: string;
  foreground: string;
  muted: string;
  faint: string;
  keyword: string;
  string: string;
  number: string;
  function: string;
  variable: string;
  type: string;
  /** Which syntax color serves as the accent (buttons, links, focus). */
  accent: 'keyword' | 'string' | 'number' | 'function' | 'variable' | 'type';
}

export const THEME_PALETTES: readonly ThemePalette[] = [
  { id: 'dusk', name: 'Dusk', scheme: 'dark', background: '#15100c', surface: '#1e1813', raised: '#261f1a', overlay: '#2c251e', border: '#3e362d', foreground: '#ede7de', muted: '#ab9f92', faint: '#7a7166', keyword: '#d08bda', string: '#a1c379', number: '#f4a952', function: '#74b2f1', variable: '#83c9e2', type: '#ebc05c', accent: 'number' },
  { id: 'dawn', name: 'Dawn', scheme: 'light', background: '#f3efe7', surface: '#fbfaf6', raised: '#f7f4ed', overlay: '#fdfcf9', border: '#d7cec1', foreground: '#32251a', muted: '#6d5e50', faint: '#94887a', keyword: '#9921ab', string: '#45711e', number: '#ad560b', function: '#0f5bb3', variable: '#126b91', type: '#99650a', accent: 'number' },
  { id: 'studio-dark', name: 'Studio Dark', scheme: 'dark', background: '#1e1e1e', surface: '#252526', raised: '#2d2d30', overlay: '#333333', border: '#454545', foreground: '#d4d4d4', muted: '#9d9d9d', faint: '#6e6e6e', keyword: '#569cd6', string: '#ce9078', number: '#b5cea8', function: '#dcdcaa', variable: '#9cdcfe', type: '#4ec9b0', accent: 'keyword' },
  { id: 'studio-light', name: 'Studio Light', scheme: 'light', background: '#ffffff', surface: '#f3f3f3', raised: '#ececec', overlay: '#ffffff', border: '#c8c8c8', foreground: '#333333', muted: '#616161', faint: '#8e8e8e', keyword: '#0000ff', string: '#a31515', number: '#098658', function: '#795d26', variable: '#000f80', type: '#267e99', accent: 'keyword' },
  { id: 'harbor-dark', name: 'Harbor Dark', scheme: 'dark', background: '#0d1117', surface: '#161b22', raised: '#21262d', overlay: '#1c2128', border: '#30363d', foreground: '#c9d1d9', muted: '#8b949e', faint: '#6e7681', keyword: '#ff7c72', string: '#a5d7ff', number: '#79c0ff', function: '#d2a8ff', variable: '#ffa657', type: '#7ee787', accent: 'number' },
  { id: 'harbor-light', name: 'Harbor Light', scheme: 'light', background: '#ffffff', surface: '#f6f8fa', raised: '#eaeef2', overlay: '#ffffff', border: '#d0d7de', foreground: '#24292f', muted: '#57606a', faint: '#8c959f', keyword: '#cf222e', string: '#0a3069', number: '#0551ae', function: '#8250df', variable: '#953900', type: '#11632a', accent: 'number' },
  { id: 'graphite', name: 'Graphite', scheme: 'dark', background: '#282c34', surface: '#21252b', raised: '#2c313a', overlay: '#333842', border: '#3e4451', foreground: '#abb2bf', muted: '#7f848e', faint: '#5c6370', keyword: '#c678dd', string: '#98c379', number: '#d19a66', function: '#61afef', variable: '#e06c76', type: '#e5c07b', accent: 'function' },
  { id: 'neon-night', name: 'Neon Night', scheme: 'dark', background: '#1a1b26', surface: '#16161e', raised: '#292e42', overlay: '#24283b', border: '#3b4261', foreground: '#c0caf5', muted: '#787c99', faint: '#565f89', keyword: '#ba9af7', string: '#9ece6a', number: '#ff9d64', function: '#7aa2f7', variable: '#7dcfff', type: '#2ac3de', accent: 'function' },
  { id: 'cocoa', name: 'Cocoa', scheme: 'dark', background: '#1e1e2e', surface: '#181825', raised: '#313244', overlay: '#292c3d', border: '#45475a', foreground: '#cdd6f4', muted: '#a6adc8', faint: '#6c7086', keyword: '#cba6f7', string: '#a7e3a1', number: '#fab387', function: '#89b4fa', variable: '#94e2d5', type: '#f9e1af', accent: 'function' },
  { id: 'cream', name: 'Cream', scheme: 'light', background: '#eff1f5', surface: '#e6e9ef', raised: '#dce0e8', overlay: '#eff1f5', border: '#bcc0cc', foreground: '#4c4f69', muted: '#6c6f85', faint: '#9ca0b0', keyword: '#8839ef', string: '#40a02b', number: '#fe640b', function: '#1e66f5', variable: '#179299', type: '#df8e1d', accent: 'function' },
  { id: 'nocturne', name: 'Nocturne', scheme: 'dark', background: '#282a36', surface: '#21222c', raised: '#343746', overlay: '#3b3d4f', border: '#44475a', foreground: '#f8f8f2', muted: '#b6b9ce', faint: '#6273a4', keyword: '#ff79c5', string: '#f1fa8c', number: '#bd93f9', function: '#50fa7a', variable: '#8be8fd', type: '#ffb86c', accent: 'number' },
  { id: 'fjord', name: 'Fjord', scheme: 'dark', background: '#2e3440', surface: '#3b4252', raised: '#434c5e', overlay: '#3b4252', border: '#4c566a', foreground: '#d8dee9', muted: '#a3abbc', faint: '#616e88', keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead', function: '#88c1d0', variable: '#8fbcbb', type: '#8fbcbb', accent: 'function' },
  { id: 'amber-dark', name: 'Amber Dark', scheme: 'dark', background: '#0a0e14', surface: '#0f131a', raised: '#161b24', overlay: '#161b24', border: '#2d3640', foreground: '#b3b1ad', muted: '#787f86', faint: '#5c6773', keyword: '#ff8f40', string: '#c2d94c', number: '#e6b450', function: '#ffb554', variable: '#39bbe6', type: '#59c2ff', accent: 'function' },
  { id: 'amber-light', name: 'Amber Light', scheme: 'light', background: '#fafafa', surface: '#f3f4f5', raised: '#eceef0', overlay: '#ffffff', border: '#d9dbde', foreground: '#5c6773', muted: '#8a9199', faint: '#abb0b6', keyword: '#fa8c3e', string: '#86b300', number: '#a37acc', function: '#f2ae49', variable: '#399ee6', type: '#55b4d4', accent: 'function' },
];
