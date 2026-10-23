import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches characters in order, case-insensitively', () => {
    expect(fuzzyMatch('opp', 'Open Preferences')?.positions).toEqual([0, 1, 5]);
    expect(fuzzyMatch('pref', 'Open Preferences')?.positions).toEqual([5, 6, 7, 8]);
    expect(fuzzyMatch('xyz', 'Open Preferences')).toBeNull();
    expect(fuzzyMatch('poe', 'open')).toBeNull();
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });

  it('prefers word starts and consecutive characters', () => {
    const names = ['src/main/repos/create.ts', 'src/main/git/commitOps.ts', 'docs/architecture.md'];
    expect(fuzzyFilter('co', names, (x) => x)[0]!.item).toBe('src/main/git/commitOps.ts');
    expect(fuzzyFilter('create', names, (x) => x)[0]!.item).toBe('src/main/repos/create.ts');
    // Camel case humps count as word starts.
    expect(fuzzyMatch('cO', 'commitOps')!.positions).toEqual([0, 6]);
  });

  it('prefers matches in the file name over the folders', () => {
    const files = ['tests/e2e/suites/stash.mjs', 'src/main/git/stash.ts', 'src/shared/state.ts'];
    const ranked = fuzzyFilter('stash.ts', files, (x) => x).map((r) => r.item);
    expect(ranked[0]).toBe('src/main/git/stash.ts');
  });

  it('ignores spaces in the query and keeps the best limit', () => {
    expect(fuzzyMatch('stage all', 'Changes: Stage all changes')).not.toBeNull();
    const many = Array.from({ length: 500 }, (_, i) => `file${i}.txt`);
    expect(fuzzyFilter('file', many, (x) => x, 20)).toHaveLength(20);
    expect(fuzzyFilter('', many, (x) => x, 3).map((r) => r.item)).toEqual(['file0.txt', 'file1.txt', 'file2.txt']);
  });
});
