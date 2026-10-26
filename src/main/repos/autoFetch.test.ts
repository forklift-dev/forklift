import { describe, expect, it } from 'vitest';
import type { RepoData } from '../../shared/state';
import type { GitService } from '../git/service';
import { SettingsFile } from '../settings/file';
import { SettingsService } from '../settings/service';
import { createAppStore } from '../store';
import { loadRepo, tabOpened } from '../store/reposSlice';
import { AutoFetch } from './autoFetch';
import { NetworkOps } from './network';

const data = (root: string): RepoData =>
  ({
    root,
    name: 'r',
    branch: { head: 'main', oid: 'a'.repeat(40), upstream: null, ahead: 0, behind: 0 },
    branches: [],
    remoteBranches: [],
    tags: [],
    remotes: ['origin'],
    remoteUrls: {},
    stashes: [],
    operation: null,
    preparedMessage: null,
    pullRebase: false,
    refs: {},
    historyVersion: 'v',
    commitGraph: false,
    changes: [],
    loadedAt: 1,
  }) as RepoData;

async function setup(fetchError?: Error) {
  const git = { resolveRoot: async (p: string) => p, read: async (p: string) => data(p) } as unknown as GitService;
  const store = createAppStore({ version: '0', platform: 'linux' }, { git });
  const settings = new SettingsService({ store, file: new SettingsFile('/nonexistent/settings.json'), runner: { environment: async () => ({}) }, isOpenRepo: () => true });
  store.dispatch(tabOpened({ id: '/r' }));
  await store.dispatch(loadRepo('/r'));
  let now = 0;
  let focused = true;
  const fetches: Array<{ interactive: boolean | undefined; prune: boolean }> = [];
  const auto = new AutoFetch({
    store,
    settings,
    networkOps: new NetworkOps(store),
    remotes: {
      fetch: async (_root, _remote, prune, _run, interactive) => {
        fetches.push({ interactive, prune });
        if (fetchError) throw fetchError;
      },
    },
    isFocused: () => focused,
    now: () => now,
  });
  return { store, settings, auto, fetches, advance: (minutes: number) => (now += minutes * 60_000), blur: () => (focused = false) };
}

describe('AutoFetch', () => {
  it('fetches the active repository when due, without prompts, and not on opening', async () => {
    const { auto, fetches, advance } = await setup();
    expect(await auto.tick()).toBe(false); // starts the clock
    advance(9);
    expect(await auto.tick()).toBe(false);
    advance(2);
    expect(await auto.tick()).toBe(true);
    expect(fetches).toEqual([{ interactive: false, prune: false }]);
    auto.fetched('/r');
    advance(5);
    expect(await auto.tick()).toBe(false);
  });

  it('pauses without focus, honours the settings, and reports needed credentials once', async () => {
    const { auto, fetches, advance, blur, settings, store } = await setup(new Error("fatal: could not read Username for 'https://x': terminal prompts disabled"));
    await settings.update({ values: { 'general.autoFetchMinutes': 1, 'general.fetchPrune': true } });
    await auto.tick();
    advance(2);
    expect(await auto.tick()).toBe(false);
    expect(fetches).toEqual([{ interactive: false, prune: true }]);
    expect(store.getState().app.notices[0]).toMatch(/needs credentials/);
    advance(2);
    await auto.tick();
    expect(fetches).toHaveLength(1); // skipped until fetched by hand
    auto.fetched('/r');
    blur();
    advance(2);
    expect(await auto.tick()).toBe(false);
    await settings.update({ values: { 'general.autoFetch': false } });
    expect(fetches).toHaveLength(1);
  });
});
