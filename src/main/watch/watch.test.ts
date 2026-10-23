import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyPath } from './paths';
import { Refresher } from './refresher';
import { RepoWatcher } from './watcher';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('classifyPath', () => {
  const root = '/r';
  const git = '/r/.git';
  it.each([
    ['/r/.git/HEAD', 'git'],
    ['/r/.git/index', 'git'],
    ['/r/.git/refs/heads/main', 'git'],
    ['/r/.git/refs/stash', 'git'],
    ['/r/.git/packed-refs', 'git'],
    ['/r/.git/MERGE_HEAD', 'git'],
    ['/r/.git/rebase-merge/done', 'git'],
    ['/r/.git/index.lock', 'none'],
    ['/r/.git/refs/heads/main.lock', 'none'],
    ['/r/.git/objects/ab/cdef', 'none'],
    ['/r/.git/logs/HEAD', 'none'],
    ['/r/.git/FETCH_HEAD', 'none'],
    ['/r/src/a.ts', 'worktree'],
    ['/r/.gitignore', 'worktree'],
    ['/elsewhere/x', 'none'],
  ])('%s → %s', (path, kind) => {
    expect(classifyPath(path, root, git).kind).toBe(kind);
  });

  it('gives working tree paths in git form and handles a separate git dir', () => {
    expect(classifyPath('/r/src/a b.ts', root, git)).toEqual({ kind: 'worktree', path: 'src/a b.ts' });
    expect(classifyPath('/main/.git/worktrees/w/HEAD', '/w', '/main/.git/worktrees/w').kind).toBe('git');
  });
});

describe('Refresher', () => {
  it('merges bursts and never runs two refreshes at once', async () => {
    let running = 0;
    let maxRunning = 0;
    let runs = 0;
    const refresher = new Refresher(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      runs++;
      await sleep(60);
      running--;
    }, 20);
    for (let i = 0; i < 10; i++) refresher.request();
    await sleep(40);
    // During the run: several requests → exactly one more run afterwards.
    refresher.request();
    refresher.request();
    await sleep(200);
    expect(runs).toBe(2);
    expect(maxRunning).toBe(1);
    refresher.stop();
    refresher.request();
    await sleep(60);
    expect(runs).toBe(2);
  });
});

describe.skipIf(process.platform === 'win32')('RepoWatcher', () => {
  let root: string;
  let watcher: RepoWatcher | null = null;
  let changes = 0;
  const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env });
  const settle = async () => {
    await sleep(400);
    const seen = changes;
    changes = 0;
    return seen;
  };

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-watch-')));
    git('init', '-q', '--initial-branch=main');
    writeFileSync(join(root, '.gitignore'), 'build/\n*.log\n');
    writeFileSync(join(root, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    mkdirSync(join(root, 'build'));
    changes = 0;
    watcher = await RepoWatcher.start(root, { changed: () => changes++, failed: (error) => expect.fail(error.message) });
  });

  afterEach(async () => {
    await watcher?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('reports edits, new files and git commands, not ignored files or object writes', async () => {
    appendFileSync(join(root, 'a.txt'), 'two\n');
    expect(await settle()).toBeGreaterThan(0);

    writeFileSync(join(root, 'build', 'out.js'), 'x');
    writeFileSync(join(root, 'debug.log'), 'x');
    expect(await settle()).toBe(0);

    writeFileSync(join(root, 'new.txt'), 'x');
    expect(await settle()).toBeGreaterThan(0);

    git('add', '.');
    expect(await settle()).toBeGreaterThan(0);
    git('commit', '-qm', 'second');
    expect(await settle()).toBeGreaterThan(0);

    // Objects only (no ref or index change).
    execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: 'loose object' });
    expect(await settle()).toBe(0);
  });

  it('stops reporting after stop()', async () => {
    await watcher!.stop();
    writeFileSync(join(root, 'after.txt'), 'x');
    expect(await settle()).toBe(0);
  });
});

describe('WatchManager', () => {
  it('watches only the active readable tab and reports a watching failure once', async () => {
    const { createAppStore } = await import('../store');
    const { tabActivated, tabOpened } = await import('../store/reposSlice');
    const { WatchManager } = await import('./manager');
    const store = createAppStore({ version: '0', platform: 'linux' }, { git: {} as never });
    const started: string[] = [];
    const stopped: string[] = [];
    let fail: ((error: Error) => void) | null = null;
    const manager = new WatchManager(store, async (root, events) => {
      started.push(root);
      fail = events.failed;
      return { stop: async () => void stopped.push(root) } as unknown as RepoWatcher;
    });
    manager.start();
    store.dispatch(tabOpened({ id: '/a' }));
    store.dispatch(tabOpened({ id: '/b' }));
    store.dispatch(tabActivated('/a'));
    await sleep(10);
    expect(started).toEqual(['/a', '/b', '/a']);
    expect(stopped).toEqual(['/a', '/b']);

    fail!(new Error('ENOSPC: System limit for number of file watchers reached'));
    fail!(new Error('ENOSPC again'));
    const notices = store.getState().app.notices;
    expect(notices).toHaveLength(1);
    if (process.platform === 'linux') expect(notices[0]).toMatch(/max_user_watches/);
    await manager.stop();
    expect(stopped).toEqual(['/a', '/b', '/a']);
  });
});
