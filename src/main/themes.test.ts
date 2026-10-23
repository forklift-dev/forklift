import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserThemesState } from '../shared/themes';
import { readUserThemes, ThemeLibrary } from './themes';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forklift-themes-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const theme = (name: string, tokens = {}) => JSON.stringify({ meta: { name, extends: 'sand' }, tokens });

describe('readUserThemes', () => {
  it('reads every theme file and reports the broken ones', async () => {
    writeFileSync(join(dir, 'b.jsonc'), theme('Bee', { accent: '#123456' }));
    writeFileSync(join(dir, 'a.json'), theme('Ay'));
    writeFileSync(join(dir, 'bad.jsonc'), '{ "meta": {} }');
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    writeFileSync(join(dir, 'we!rd.jsonc'), theme('Weird'));
    const state = await readUserThemes(dir);
    expect(state.themes.map((t) => [t.id, t.name])).toEqual([
      ['user:a', 'Ay'],
      ['user:b', 'Bee'],
    ]);
    expect(state.themes[1]!.tokens.accent).toBe('#123456');
    expect(state.problems).toEqual([
      { file: 'bad.jsonc', message: expect.stringMatching(/meta\.name/) },
      { file: 'we!rd.jsonc', message: expect.stringMatching(/file name/) },
    ]);
  });

  it('refuses two files with the same name and very large files', async () => {
    writeFileSync(join(dir, 'x.json'), theme('One'));
    writeFileSync(join(dir, 'x.jsonc'), theme('Two'));
    writeFileSync(join(dir, 'huge.jsonc'), ' '.repeat(300 * 1024));
    const state = await readUserThemes(dir);
    expect(state.themes.map((t) => t.name)).toEqual(['One']);
    expect(state.problems.map((p) => p.file).sort()).toEqual(['huge.jsonc', 'x.jsonc']);
  });

  it('is empty for a missing folder', async () => {
    expect(await readUserThemes(join(dir, 'missing'))).toEqual({ folder: join(dir, 'missing'), themes: [], problems: [] });
  });
});

describe('ThemeLibrary', () => {
  it('creates the folder, knows built-in and user themes, and re-reads on changes', async () => {
    const folder = join(dir, 'themes');
    const seen: UserThemesState[] = [];
    const library = new ThemeLibrary(folder, (state) => seen.push(state));
    await library.start();
    try {
      expect(seen.at(-1)).toEqual({ folder, themes: [], problems: [] });
      expect(library.exists('polar')).toBe(true);
      expect(library.exists('user:new')).toBe(false);
      writeFileSync(join(folder, 'new.jsonc'), theme('New'));
      for (let i = 0; i < 50 && !library.exists('user:new'); i++) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(library.exists('user:new')).toBe(true);
      expect(seen.at(-1)!.themes.map((t) => t.id)).toEqual(['user:new']);
    } finally {
      library.stop();
    }
  });
});
