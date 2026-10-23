import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RepoData } from '../../shared/state';
import type { GitService } from '../git/service';
import { createAppStore } from '../store';
import { favoriteToggled, MAX_RECENT, repoForgotten, repoVisited } from '../store/librarySlice';
import { tabActivated, tabClosed, tabOpened } from '../store/reposSlice';
import { pathFromArgv } from './argv';
import { decodeLibrary, LibraryFile } from './libraryFile';
import { openRepository } from './open';
import { RepoScanner } from './scan';
import { RepoSession } from './session';

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-repos-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup(repos: string[]) {
  const git = {
    resolveRoot: async (path: string) => {
      const root = repos.find((r) => path === r || path.startsWith(`${r}/`));
      if (!root) throw new Error(`Not a git repository: ${path}`);
      return root;
    },
    read: async (root: string): Promise<RepoData> => ({
      root,
      name: root,
      branch: { head: 'main', oid: null, upstream: null, ahead: 0, behind: 0 },
      refs: {},
      historyVersion: 'v',
      branches: [],
      remoteBranches: [],
      tags: [],
      remotes: [],
      stashes: [],
      operation: null,
      preparedMessage: null,
      pullRebase: false,
      changes: [],
      loadedAt: Date.now(),
    }),
  } as unknown as GitService;
  return { git, store: createAppStore({ version: '0', platform: 'linux' }, { git }) };
}

describe('pathFromArgv', () => {
  it('finds the folder argument in development and packaged launches', () => {
    expect(pathFromArgv(['/usr/bin/electron', '.', '--inspect=9229', 'src/app'], false, '/home/u')).toBe('/home/u/src/app');
    expect(pathFromArgv(['/opt/Forklift/forklift', '--no-sandbox', '/repo'], true, '/')).toBe('/repo');
    expect(pathFromArgv(['/opt/Forklift/forklift'], true, '/')).toBeNull();
    expect(pathFromArgv(['/usr/bin/electron', '.', '--remote-debugging-port=1'], false, '/')).toBeNull();
    // A second instance's argv, switches moved to the front by Chromium.
    expect(pathFromArgv(['/usr/bin/electron', '--ozone-platform=x11', '--window-size=1,1', '.', '/repo'], false, '/x')).toBe('/repo');
    expect(pathFromArgv(['/usr/bin/electron', '--ozone-platform=x11', '.'], false, '/x')).toBeNull();
  });
});

describe('library', () => {
  it('keeps recent repositories newest first, unique and capped; favorites toggle; forget removes both', () => {
    const { store } = setup([]);
    for (let i = 0; i < MAX_RECENT + 5; i++) store.dispatch(repoVisited({ path: `/r${i}`, at: i }));
    store.dispatch(repoVisited({ path: '/r10', at: 1000 }));
    const { recent } = store.getState().library;
    expect(recent).toHaveLength(MAX_RECENT);
    expect(recent[0]).toEqual({ path: '/r10', name: 'r10', openedAt: 1000 });
    expect(recent.filter((r) => r.path === '/r10')).toHaveLength(1);
    store.dispatch(favoriteToggled('/r10'));
    expect(store.getState().library.favorites).toEqual(['/r10']);
    store.dispatch(repoForgotten('/r10'));
    expect(store.getState().library.favorites).toEqual([]);
    expect(store.getState().library.recent.some((r) => r.path === '/r10')).toBe(false);
  });

  it('decodes leniently: bad entries dropped, active must be one of the tabs', () => {
    const decoded = decodeLibrary(
      JSON.stringify({
        version: 1,
        session: { tabs: ['/a', 'relative', 42, '/a', '/b'], active: '/zzz' },
        library: { recent: [{ path: '/a', name: 'a', openedAt: 5, extra: 1 }, { path: 'x' }], favorites: ['/a', '/a', 3] },
      }),
    );
    expect(decoded).toEqual({
      session: { tabs: ['/a', '/b'], active: '/a' },
      library: { recent: [{ path: '/a', name: 'a', openedAt: 5 }], favorites: ['/a'] },
    });
  });

  it('a damaged file is set aside and the app starts without remembered repositories', async () => {
    const path = join(dir, 'repositories.json');
    writeFileSync(path, '{ nope');
    expect(await new LibraryFile(path).load()).toEqual({ session: { tabs: [], active: null }, library: { recent: [], favorites: [] } });
    expect(readFileSync(`${path}.damaged`, 'utf8')).toBe('{ nope');
  });
});

describe('openRepository', () => {
  it('opens the containing repository once, records it as recent, and reports non-repositories', async () => {
    const { store, git } = setup(['/work/app']);
    expect(await openRepository(store, git, '/work/app/src')).toBe('/work/app');
    expect(await openRepository(store, git, '/work/app')).toBe('/work/app');
    expect(store.getState().repos.view.tabs.map((t) => t.id)).toEqual(['/work/app']);
    expect(store.getState().repos.byId['/work/app']?.data?.root).toBe('/work/app');
    expect(store.getState().library.recent.map((r) => r.path)).toEqual(['/work/app']);
    await expect(openRepository(store, git, '/tmp/nothing')).rejects.toThrow('Not a git repository');
    expect(store.getState().repos.view.tabs).toHaveLength(1);
  });
});

describe('RepoSession', () => {
  it('saves tabs on change and restores them with the active one read; missing ones show an error', async () => {
    const file = new LibraryFile(join(dir, 'repositories.json'));
    const first = setup(['/a', '/b', '/c']);
    await new RepoSession(first.store, file).load(true);
    for (const path of ['/a', '/b', '/c']) await openRepository(first.store, first.git, path);
    first.store.dispatch(tabActivated('/b'));
    await settle();
    expect(JSON.parse(readFileSync(file.path, 'utf8')).session).toEqual({ tabs: ['/a', '/b', '/c'], active: '/b' });

    // Next run: /c is gone.
    const second = setup(['/a', '/b']);
    await new RepoSession(second.store, file).load(true);
    await settle();
    const { repos } = second.store.getState();
    expect(repos.view.tabs.map((t) => t.id)).toEqual(['/a', '/b', '/c']);
    expect(repos.view.activeId).toBe('/b');
    expect(repos.byId['/b']?.data?.root).toBe('/b');
    expect(repos.byId['/a']?.data).toBeNull(); // read when first shown
    expect(second.store.getState().library.recent.map((r) => r.path)).toEqual(['/c', '/b', '/a']);

    second.store.dispatch(tabClosed('/c'));
    await settle();
    expect(JSON.parse(readFileSync(file.path, 'utf8')).session.tabs).toEqual(['/a', '/b']);

    const third = setup(['/a', '/b']);
    await new RepoSession(third.store, file).load(false);
    expect(third.store.getState().repos.view.tabs).toEqual([]);
    expect(third.store.getState().library.recent).toHaveLength(3);
  });

  it('turns failures to open a path from outside the window into notices', async () => {
    const { store, git } = setup([]);
    const session = new RepoSession(store, new LibraryFile(join(dir, 'r.json')));
    const notices: string[] = [];
    await session.open(git, '/not/a/repo', (message) => notices.push(message));
    expect(notices).toEqual(['Could not open /not/a/repo: Not a git repository: /not/a/repo']);
    store.dispatch(tabOpened({ id: '/x' })); // unrelated: the store still works
  });
});

describe('RepoScanner', () => {
  it('finds repositories under a folder as their roots, sorted', async () => {
    for (const repo of ['b/two', 'a/one', 'a/one/nested']) {
      mkdirSync(join(dir, repo), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: join(dir, repo) });
    }
    mkdirSync(join(dir, 'plain'));
    expect(await new RepoScanner().scan(dir)).toEqual([join(dir, 'a/one'), join(dir, 'b/two')]);
  });

  it('a newer scan or cancel() stops the current one', async () => {
    let calls = 0;
    const fake = async (_path: string, progress: (repos: string[]) => boolean | void) => {
      for (let i = 0; i < 100; i++) {
        await settle();
        calls++;
        if (progress([`/r${i}/.git`])) return [];
      }
      return [];
    };
    const scanner = new RepoScanner(fake);
    const first = scanner.scan('/x');
    await settle();
    scanner.cancel();
    expect((await first).length).toBeLessThan(10);
    expect(calls).toBeLessThan(10);
  });
});
