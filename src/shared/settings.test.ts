import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  effectiveSettings,
  parseSettingValue,
  REPO_SETTING_KEYS,
  SETTING_FIELDS,
  SETTING_KEYS,
  SETTINGS_SECTIONS,
  SettingValueError,
} from './settings';

describe('settings schema', () => {
  it('has a valid default for every field and a known section', () => {
    const defaults = defaultSettings();
    for (const key of SETTING_KEYS) {
      expect(parseSettingValue(key, defaults[key])).toEqual(defaults[key]);
      expect(Object.keys(SETTINGS_SECTIONS)).toContain(SETTING_FIELDS[key].section);
    }
  });

  it('gives each call its own copy of object defaults', () => {
    const a = defaultSettings();
    (a['tools.editor'] as { mode: string }).mode = 'custom';
    expect(defaultSettings()['tools.editor']).toEqual({ mode: 'auto' });
  });

  it('lets repositories override only external tools', () => {
    expect(REPO_SETTING_KEYS).toEqual(['tools.editor', 'tools.terminal', 'tools.diff', 'tools.merge']);
  });

  it('applies overrides on top of global values', () => {
    const values = defaultSettings();
    const effective = effectiveSettings(values, { 'tools.editor': { mode: 'preset', id: 'zed' } });
    expect(effective['tools.editor']).toEqual({ mode: 'preset', id: 'zed' });
    expect(effective['diff.layout']).toBe('split');
    expect(effectiveSettings(values, undefined)).toBe(values);
  });
});

describe('parseSettingValue', () => {
  it.each([
    ['diff.ignoreWhitespace', 'yes'],
    ['diff.contextLines', 2.5],
    ['diff.contextLines', -1],
    ['editor.fontSize', 100],
    ['diff.layout', 'hunks'],
    ['editor.fontFamily', 'x'.repeat(201)],
    ['git.executable', 'bad\0path'],
    ['tools.editor', null],
    ['tools.editor', { mode: 'shell', command: 'rm -rf /' }],
    ['tools.editor', { mode: 'preset', id: '../evil' }],
    ['tools.editor', { mode: 'custom', command: '', args: [] }],
    ['tools.editor', { mode: 'custom', command: 'code', args: 'a b' }],
    ['tools.editor', { mode: 'custom', command: 'code', args: [1] }],
    ['tools.diff', { mode: 'tool', name: 'meld; rm -rf /' }],
    ['tools.merge', { mode: 'custom', command: 'meld', args: [] }],
  ] as const)('rejects %s = %j', (key, value) => {
    expect(() => parseSettingValue(key, value)).toThrow(SettingValueError);
  });

  it('returns clean copies without extra fields', () => {
    expect(parseSettingValue('tools.editor', { mode: 'custom', command: ' /opt/ed ', args: ['{file}'], extra: 1 })).toEqual({
      mode: 'custom',
      command: '/opt/ed',
      args: ['{file}'],
    });
    expect(parseSettingValue('tools.merge', { mode: 'custom', command: 'meld', args: ['$MERGED'], trustExitCode: true })).toEqual({
      mode: 'custom',
      command: 'meld',
      args: ['$MERGED'],
      trustExitCode: true,
    });
    expect(parseSettingValue('tools.diff', { mode: 'tool', name: 'bc4', junk: true })).toEqual({ mode: 'tool', name: 'bc4' });
    expect(parseSettingValue('editor.fontFamily', '  "Fira Code", monospace ')).toBe('"Fira Code", monospace');
  });
});
