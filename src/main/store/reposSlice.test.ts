import { describe, expect, it } from 'vitest';
import type { RepoData } from '../../shared/state';
import type { GitService } from '../git/service';
import { createAppStore, projectState } from './index';
import { loadRepo, tabActivated, tabClosed, tabMoved, tabOpened } from './reposSlice';

const data = (root: string): RepoData => ({
  root,
  name: root.slice(1),
  branch: { head: 'main', oid: null, upstream: null, ahead: 0, behind: 0 },
  refs: {},
  historyVersion: 'v',
      branches: [],
      remoteBranches: [],
      tags: [],
      remotes: [],
      stashes: [],
  changes: [],
  loadedAt: 1,
});

function setup(roots: Record<string, string> = {}) {
  const git = {
    resolveRoot: async (path: string) => {
      if (!(path in roots)) throw new Error(`not a repository: ${path}`);
      return roots[path]!;
    },
    read: async (root: string) => data(root),
  } as unknown as GitService;
  return createAppStore({ version: '0', platform: 'linux' }, { git });
}

const ids = (store: ReturnType<typeof setup>) => store.getState().repos.view.tabs.map((tab) => tab.id);

describe('tabs', () => {
  it('opens tabs after the active one and activates them; reopening switches to the existing tab', () => {
    const store = setup();
    store.dispatch(tabOpened({ id: '/a' }));
    store.dispatch(tabOpened({ id: '/b' }));
    store.dispatch(tabActivated('/a'));
    store.dispatch(tabOpened({ id: '/c' }));
    expect(ids(store)).toEqual(['/a', '/c', '/b']);
    store.dispatch(tabOpened({ id: '/b' }));
    expect(ids(store)).toEqual(['/a', '/c', '/b']);
    expect(store.getState().repos.view.activeId).toBe('/b');
    store.dispatch(tabOpened({ id: '/d', activate: false }));
    expect(store.getState().repos.view.activeId).toBe('/b');
  });

  it('closing the active tab activates the right neighbour, else the left one', () => {
    const store = setup();
    for (const id of ['/a', '/b', '/c']) store.dispatch(tabOpened({ id }));
    store.dispatch(tabActivated('/b'));
    store.dispatch(tabClosed('/b'));
    expect(store.getState().repos.view.activeId).toBe('/c');
    store.dispatch(tabClosed('/c'));
    expect(store.getState().repos.view.activeId).toBe('/a');
    store.dispatch(tabClosed('/a'));
    expect(store.getState().repos.view).toEqual({ tabs: [], activeId: null });
    expect(store.getState().repos.byId).toEqual({});
  });

  it('moves tabs within bounds', () => {
    const store = setup();
    for (const id of ['/a', '/b', '/c']) store.dispatch(tabOpened({ id }));
    store.dispatch(tabMoved({ id: '/a', index: 2 }));
    expect(ids(store)).toEqual(['/b', '/c', '/a']);
    store.dispatch(tabMoved({ id: '/a', index: 99 }));
    expect(ids(store)).toEqual(['/b', '/c', '/a']);
    store.dispatch(tabMoved({ id: '/c', index: 0 }));
    expect(ids(store)).toEqual(['/c', '/b', '/a']);
  });

  it('loads per tab, reflects loading and errors on the tab, ignores results for closed tabs', async () => {
    const store = setup({ '/a': '/a', '/moved': '/elsewhere' });
    store.dispatch(tabOpened({ id: '/a' }));
    const pending = store.dispatch(loadRepo('/a'));
    expect(store.getState().repos.view.tabs[0]).toMatchObject({ loading: true });
    await pending;
    expect(store.getState().repos.byId['/a']?.data?.root).toBe('/a');
    expect(store.getState().repos.view.tabs[0]).toMatchObject({ loading: false, error: null });

    // A remembered path that now resolves to another repository is reported, not silently swapped.
    store.dispatch(tabOpened({ id: '/moved' }));
    await store.dispatch(loadRepo('/moved'));
    expect(store.getState().repos.byId['/moved']?.error).toBe('No repository at /moved any more');
    expect(store.getState().repos.view.tabs.find((t) => t.id === '/moved')?.error).toMatch(/No repository/);

    const late = store.dispatch(loadRepo('/a'));
    store.dispatch(tabClosed('/a'));
    await late;
    expect(store.getState().repos.byId['/a']).toBeUndefined();
  });
});

describe('projectState', () => {
  it('shows only the active repository and keeps references stable', async () => {
    const store = setup({ '/a': '/a', '/b': '/b' });
    store.dispatch(tabOpened({ id: '/a' }));
    await store.dispatch(loadRepo('/a'));
    store.dispatch(tabOpened({ id: '/b' }));
    await store.dispatch(loadRepo('/b'));
    const first = projectState(store.getState());
    expect(first.repo.data?.root).toBe('/b');
    expect(first.tabs.tabs.map((t) => t.name)).toEqual(['a', 'b']);
    expect('byId' in first).toBe(false);

    // Re-reading the inactive tab changes neither what the window sees nor its references.
    await store.dispatch(loadRepo('/a'));
    const second = projectState(store.getState());
    expect(second.repo).toBe(first.repo);
    expect(second.settings).toBe(first.settings);

    store.dispatch(tabActivated('/a'));
    expect(projectState(store.getState()).repo.data?.root).toBe('/a');
    store.dispatch(tabClosed('/a'));
    store.dispatch(tabClosed('/b'));
    expect(projectState(store.getState()).repo).toMatchObject({ path: null, data: null });
  });
});
