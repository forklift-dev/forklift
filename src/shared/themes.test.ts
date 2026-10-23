import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, contrastProblems, contrastRatio, parseJsonc, parseUserTheme, resolveTheme, THEME_TOKENS } from './themes';

describe('built-in themes', () => {
  it('define every token with a valid color', () => {
    for (const theme of BUILTIN_THEMES) {
      expect(Object.keys(theme.tokens).sort(), theme.id).toEqual([...THEME_TOKENS].sort());
      for (const [token, color] of Object.entries(theme.tokens)) expect(color, `${theme.id} ${token}`).toMatch(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/);
    }
  });

  it.each(BUILTIN_THEMES.map((theme) => [theme.id, theme] as const))('%s keeps text readable (7:1 high contrast, 4.5:1 otherwise)', (_id, theme) => {
    expect(contrastProblems(theme)).toEqual([]);
  });

  it('has at least six, with unique ids', () => {
    expect(new Set(BUILTIN_THEMES.map((theme) => theme.id)).size).toBe(BUILTIN_THEMES.length);
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(6);
  });
});

describe('contrast', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    // Translucent backgrounds are painted over their base first.
    expect(contrastRatio('#000000', '#00000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff80', '#000000')).toBeLessThan(5);
  });
});

describe('resolveTheme', () => {
  it('follows the system for "system" and unknown ids', () => {
    expect(resolveTheme('system', true).id).toBe('forklift-dark');
    expect(resolveTheme('system', false).id).toBe('forklift-light');
    expect(resolveTheme('user:gone', false).id).toBe('forklift-light');
    expect(resolveTheme('polar', false).id).toBe('polar');
  });
});

describe('user themes', () => {
  it('reads JSONC with comments and trailing commas', () => {
    expect(parseJsonc('{ // note\n "a": "x // not a comment", /* block */ "b": [1, 2,], }')).toEqual({ a: 'x // not a comment', b: [1, 2] });
  });

  it('extends a built-in theme with overrides', () => {
    const theme = parseUserTheme('mine', '{ "meta": { "name": "Mine", "extends": "polar" }, "tokens": { "accent": "#ff8800" } }');
    expect(theme).toMatchObject({ id: 'user:mine', name: 'Mine', scheme: 'dark', highContrast: false });
    expect(theme.tokens.accent).toBe('#ff8800');
    expect(theme.tokens.bg).toBe(resolveTheme('polar', false).tokens.bg);
    expect(parseUserTheme('l', '{ "meta": { "name": "L", "scheme": "light" } }').tokens.bg).toBe('#ffffff');
  });

  it.each([
    ['not json', /Not valid JSON/],
    ['[]', /must contain an object/],
    ['{ "tokens": {} }', /"meta" is missing/],
    ['{ "meta": { "name": "" } }', /meta\.name/],
    ['{ "meta": { "name": "x", "scheme": "dim" } }', /meta\.scheme/],
    ['{ "meta": { "name": "x", "extends": "nord" } }', /meta\.extends/],
    ['{ "meta": { "name": "x" }, "tokens": { "bogus": "#fff" } }', /Unknown token "bogus"/],
    ['{ "meta": { "name": "x" }, "tokens": { "bg": "red" } }', /"bg" must be a color/],
  ])('explains what is wrong with %s', (text, message) => {
    expect(() => parseUserTheme('t', text)).toThrow(message);
  });
});
