import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitCli } from '../git/cli';
import { createGitService } from '../git/service';
import { directRunner } from '../process/testing';
import { CommitTable } from './commits';
import { HistoryService } from './service';
import { decode, encode, HistoryStore, type HistorySnapshot } from './store';

let root: string;
let saved: string;
const git = createGitService();
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env }).toString().trim();

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-history-store-')));
  saved = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-history-saved-')));
  execFileSync(process.execPath, [join(__dirname, '../../../scripts/make-history-repo.mjs'), root, '25000', '3'], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' } });
  // A stash: its row sits above its base and is saved with the history.
  sh('checkout', '-q', 'main');
  writeFileSync(join(root, 'wip.txt'), 'work in progress\n');
  sh('add', 'wip.txt');
  sh('stash', 'push', '-q', '-m', 'Half done');
  // 25 000 commits take a few seconds, more while the other suites run alongside.
}, 60_000);
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(saved, { recursive: true, force: true });
});

describe('saved histories', () => {
  it('encode and decode give back the same snapshot, shas outside the rows included', () => {
    const snapshot: HistorySnapshot = {
      version: 'v1',
      filterKey: '[[],[]]',
      revisions: ['HEAD', '--branches'],
      commits: table([['a'.repeat(40), `${'b'.repeat(40)} ${'c'.repeat(40)}`], ['b'.repeat(40), '']]),
      stashes: [[0, { hash: 'a'.repeat(40), base: 'b'.repeat(40), index: 0, authorName: 'Ada', authorEmail: 'a@x', authorTime: 1, subject: 'WIP' }]],
      checkpoints: [{ lanes: [{ sha: 'b'.repeat(40), color: 3 }, null, { sha: 'c'.repeat(40), color: 7 }], nextColor: 8 }],
    };
    const { commits, ...rest } = decode(encode(snapshot));
    const { commits: expected, ...expectedRest } = snapshot;
    expect(rest).toEqual(expectedRest);
    expect(rows(commits)).toEqual(rows(expected));
    expect(commits.find('b'.repeat(40))).toBe(1);
    expect(() => decode(Buffer.from('nonsense'))).toThrow();
  });

  it('a large history read once is shown again by the next run without walking it', async () => {
    const store = new HistoryStore(saved);
    const { historyVersion } = await git.read(root);
    const first = new HistoryService(new GitCli(directRunner()), store);
    const whole = await first.page(root, historyVersion, 0, 30_000);
    expect(whole.complete).toBe(true);
    expect(whole.rows.some((row) => row.stash)).toBe(true);
    // Saved in the background once read.
    for (let i = 0; i < 100 && !readdirSync(saved).some((name) => name.endsWith('.history')); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(readdirSync(saved).filter((name) => name.endsWith('.history'))).toHaveLength(1);

    // No rev-list this time: the shape comes from the file (details still from git, for the rows shown).
    const runs: string[][] = [];
    const runner = directRunner();
    const counting: typeof runner = { ...runner, run: (command, args, options) => (runs.push([...args]), runner.run(command, args, options)) };
    const next = new HistoryService(new GitCli(counting), store);
    for (const [start, count] of [[0, 300], [12_000, 500], [24_700, 400]] as const) {
      const page = await next.page(root, historyVersion, start, count);
      expect(page.complete).toBe(true);
      expect(page.rows).toEqual(whole.rows.slice(start, start + count));
    }
    expect(runs.some((args) => args[0] === 'rev-list')).toBe(false);
  });

  it('restores histories of millions of rows', async () => {
    const hashes = Array.from({ length: 2_000_000 }, (_, i) => i.toString(16).padStart(40, '0'));
    const commits = table(hashes.map((hash, i) => [hash, hashes[i + 1] ?? '']));
    const snapshot: HistorySnapshot = { version: 'big', filterKey: '[[],[]]', revisions: [], commits, stashes: [], checkpoints: [{ lanes: [], nextColor: 0 }] };
    const store = new HistoryStore(saved);
    await store.save('/big', snapshot);
    const loaded = await store.load('/big', 'big', '[[],[]]');
    expect(loaded?.commits.length).toBe(2_000_000);
    expect(loaded?.commits.parents(1_000_000)).toEqual([hashes[1_000_001]]);
    const history = new HistoryService(new GitCli(directRunner()), { load: async () => loaded, save: async () => {} });
    // The stand-in store gives this snapshot for the repository: its last row is found without any walk.
    expect(await history.locate(root, (await git.read(root)).historyVersion, { solo: [], hidden: [] }, hashes[1_999_999]!)).toBe(1_999_999);
  }, 60_000);

  it('a history of another version is read again', async () => {
    const store = new HistoryStore(saved);
    sh('commit', '--allow-empty', '-qm', 'Newer');
    const { historyVersion } = await git.read(root);
    expect(await store.load(root, historyVersion, '[[],[]]')).toBeNull();
    const page = await new HistoryService(new GitCli(directRunner()), store).page(root, historyVersion, 0, 5);
    expect(page.rows[0]?.subject).toBe('Newer');
  });
});

function table(rows: Array<[hash: string, parents: string]>): CommitTable {
  const commits = new CommitTable();
  for (const [hash, parents] of rows) commits.add(hash, parents);
  return commits;
}

const rows = (commits: CommitTable) => Array.from({ length: commits.length }, (_, row) => [commits.hash(row), commits.parents(row)]);
