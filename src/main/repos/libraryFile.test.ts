import { describe, expect, it } from 'vitest';
import { decodeLibrary, encodeLibrary } from './libraryFile';

describe('repository library groups', () => {
  it('loads repositories.json files written before groups existed', () => {
    expect(decodeLibrary(JSON.stringify({ session: { tabs: [], active: null }, library: { recent: [], favorites: [] } })).library.groups).toEqual([]);
  });

  it('persists valid groups and drops unsafe or malformed entries', () => {
    const decoded = decodeLibrary(JSON.stringify({ library: { groups: [
      { id: 'team', name: '  Team  ', color: 9, repos: ['/repo/a', '/repo/a', 'relative'] },
      { id: 'team', name: 'duplicate', color: 0, repos: ['/repo/b'] },
      { id: 'invalid id', name: 'bad', color: 0, repos: [] },
      { id: 'too-many-colors', name: 'bad color', color: 10, repos: ['/repo/c'] },
    ] } }));
    expect(decoded.library.groups).toEqual([
      { id: 'team', name: 'Team', color: 9, repos: ['/repo/a'] },
      { id: 'too-many-colors', name: 'bad color', color: 0, repos: ['/repo/c'] },
    ]);
    expect(decodeLibrary(encodeLibrary(decoded)).library.groups).toEqual(decoded.library.groups);
  });
});
