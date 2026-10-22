import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../shared/settings';
import { decodeSettings, encodeSettings, SETTINGS_VERSION, SettingsFile } from './file';

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forklift-settings-'));
  path = join(dir, 'settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('encode/decode', () => {
  it('stores only values that differ from the defaults', () => {
    const values = { ...defaultSettings(), 'diff.layout': 'inline' as const };
    const repos = { '/r': { 'tools.diff': { mode: 'tool' as const, name: 'meld' } }, '/empty': {} };
    const data = JSON.parse(encodeSettings({ values, repos }));
    expect(data).toEqual({
      version: SETTINGS_VERSION,
      settings: { 'diff.layout': 'inline' },
      repositories: { '/r': { 'tools.diff': { mode: 'tool', name: 'meld' } } },
    });
    const decoded = decodeSettings(JSON.stringify(data));
    expect(decoded.values).toEqual(values);
    expect(decoded.repos).toEqual({ '/r': repos['/r'] });
    expect(decoded.problems).toEqual([]);
  });

  it('drops unknown keys, invalid values and global-only keys in repositories, reporting each', () => {
    const decoded = decodeSettings(
      JSON.stringify({
        version: 1,
        settings: { 'diff.layout': 'diagonal', 'editor.fontSize': 15, 'old.key': true },
        repositories: { '/r': { 'diff.layout': 'inline', 'tools.editor': { mode: 'auto' } } },
      }),
    );
    expect(decoded.values['diff.layout']).toBe('split');
    expect(decoded.values['editor.fontSize']).toBe(15);
    expect(decoded.repos).toEqual({ '/r': { 'tools.editor': { mode: 'auto' } } });
    expect(decoded.problems).toHaveLength(3);
    expect(decoded.problems.join('\n')).toMatch(/diff\.layout: must be one of split, inline/);
    expect(decoded.problems.join('\n')).toMatch(/unknown setting "old\.key"/);
  });

  it('runs migrations from older versions in order', () => {
    const decoded = decodeSettings(JSON.stringify({ version: 0, settings: { 'diff.sideBySide': false } }), {
      0: (data) => {
        const { 'diff.sideBySide': sideBySide, ...rest } = data.settings;
        return { ...data, version: 1, settings: { ...rest, 'diff.layout': sideBySide === false ? 'inline' : 'split' } };
      },
    });
    expect(decoded.values['diff.layout']).toBe('inline');
    expect(decoded.problems).toEqual([]);
  });

  it('flags files written by a newer version', () => {
    expect(decodeSettings(JSON.stringify({ version: SETTINGS_VERSION + 1, settings: {} })).newerVersion).toBe(true);
  });
});

describe('SettingsFile', () => {
  it('gives defaults without a file', async () => {
    expect(await new SettingsFile(path).load()).toEqual({ values: defaultSettings(), repos: {}, problems: [] });
  });

  it('saves atomically and reads back; no temporary files remain', async () => {
    const file = new SettingsFile(join(dir, 'nested', 'settings.json'));
    const values = { ...defaultSettings(), 'editor.tabSize': 2 };
    await Promise.all([file.save({ values: defaultSettings(), repos: {} }), file.save({ values, repos: {} })]);
    expect((await file.load()).values['editor.tabSize']).toBe(2);
    expect(readdirSync(join(dir, 'nested'))).toEqual(['settings.json']);
  });

  it('keeps a damaged file aside and reports it', async () => {
    writeFileSync(path, '{ "version": 1, "settings": { oops');
    const state = await new SettingsFile(path).load();
    expect(state.values).toEqual(defaultSettings());
    expect(state.problems[0]).toMatch(/damaged.*kept at .*settings\.json\.damaged-/);
    expect(existsSync(path)).toBe(false);
    const backups = readdirSync(dir).filter((name) => name.startsWith('settings.json.damaged-'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dir, backups[0]!), 'utf8')).toContain('oops');
  });

  it('backs up a newer file before it could be overwritten', async () => {
    writeFileSync(path, JSON.stringify({ version: 99, settings: { 'editor.fontSize': 20 } }));
    const state = await new SettingsFile(path).load();
    expect(state.values['editor.fontSize']).toBe(20);
    expect(state.problems[0]).toMatch(/newer version/);
    expect(existsSync(`${path}.newer-backup`)).toBe(true);
  });
});
