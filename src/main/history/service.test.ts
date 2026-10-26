import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EdgeKind } from '../../shared/graph';
import type { HistoryPage } from '../../shared/history';
import { GitCli } from '../git/cli';
import { createGitService } from '../git/service';
import { directRunner } from '../process/testing';
import { HistoryService, summary } from './service';

let root: string;
const git = createGitService();
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env }).toString().trim();

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-history-')));
  // A long branchy history, generated quickly.
  execFileSync(process.execPath, [join(__dirname, '../../../scripts/make-history-repo.mjs'), root, '5000', '7'], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
  });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The page's rows with their passing lanes back as Pass edges (the page sends them as runs). */
function drawn({ rows, passes }: HistoryPage) {
  const result = rows.map((row) => ({ ...row, graph: { ...row.graph, edges: [...row.graph.edges] } }));
  for (let at = 0; at < passes.length; at += 4) {
    const [column, color, first, count] = passes.slice(at, at + 4) as [number, number, number, number];
    for (let row = first; row < first + count; row++) result[row]!.graph.edges.push({ kind: EdgeKind.Pass, from: column, to: column, color });
  }
  // Order within a row does not matter for drawing.
  for (const row of result) row.graph.edges.sort((a, b) => a.kind - b.kind || a.from - b.from || a.to - b.to);
  return result;
}

describe('summary', () => {
  it('is the first paragraph on one line', () => {
    expect(summary('Fix the thing\n\nBecause.')).toBe('Fix the thing');
    expect(summary('Fix the thing\nacross lines\r\n\r\nBody')).toBe('Fix the thing across lines');
    expect(summary('')).toBe('');
  });
});

describe('HistoryService', () => {
  it('serves pages in `git log --all --date-order` order, walking only as far as asked', async () => {
    const history = new HistoryService(new GitCli(directRunner()));
    const { historyVersion } = await git.read(root);
    const first = await history.page(root, historyVersion, 0, 100);
    expect(first.rows).toHaveLength(100);
    expect(first.complete).toBe(false);
    expect(first.loaded).toBeLessThan(5000);

    const expected = sh('log', '--all', '--date-order', '--format=%H').split('\n');
    const all = [...first.rows];
    for (let start = 100; ; start += 1000) {
      const page = await history.page(root, historyVersion, start, 1000);
      all.push(...page.rows);
      if (page.complete && start + 1000 >= page.loaded) break;
    }
    expect(all.map((row) => row.hash)).toEqual(expected);
    expect(all).toHaveLength(5000);
  });

  it('lays out a consistent graph: every lane at the top of a row was open at the bottom of the row above', async () => {
    const history = new HistoryService(new GitCli(directRunner()));
    const { historyVersion } = await git.read(root);
    const rows = drawn(await history.page(root, historyVersion, 0, 5000));
    expect(rows.some((row) => row.graph.edges.some((e) => e.kind === EdgeKind.Pass))).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      const bottom = new Set(rows[i - 1]!.graph.edges.filter((e) => e.kind !== EdgeKind.In).map((e) => e.to));
      const top = new Set(rows[i]!.graph.edges.filter((e) => e.kind !== EdgeKind.Out).map((e) => e.from));
      expect(top).toEqual(bottom);
    }
    // Merges have two parents and draw two lines out of their node.
    const merge = rows.find((row) => row.parents.length === 2)!;
    expect(merge.graph.edges.filter((e) => e.kind === EdgeKind.Out)).toHaveLength(2);
    expect(Math.max(...rows.map((row) => row.graph.width))).toBeLessThan(30);
  });

  it('lays out a page from the middle exactly as the whole history (saved layout states, not stored rows)', async () => {
    const history = new HistoryService(new GitCli(directRunner()));
    const { historyVersion } = await git.read(root);
    const whole = drawn(await history.page(root, historyVersion, 0, 5000));
    // Pages that start before, at and after a saved state (every 256 rows), and ones across several of them.
    for (const [start, count] of [[250, 30], [256, 1], [511, 2], [1000, 30], [3000, 1000], [4990, 50]] as const) {
      const rows = drawn(await history.page(root, historyVersion, start, count));
      expect(rows.map((row) => [row.hash, row.graph])).toEqual(whole.slice(start, start + count).map((row) => [row.hash, row.graph]));
    }
  });

  it('keeps the authors and dates git reports', async () => {
    const history = new HistoryService(new GitCli(directRunner()));
    const { historyVersion } = await git.read(root);
    const { rows } = await history.page(root, historyVersion, 0, 50);
    const expected = sh('log', '--all', '--date-order', '-50', '--format=%H %an <%ae> %at %P').split('\n');
    expect(rows.map((row) => `${row.hash} ${row.authorName} <${row.authorEmail}> ${row.authorTime} ${row.parents.join(' ')}`.trim())).toEqual(expected.map((line) => line.trim()));
  });

  it('reads details only for the rows shown, also far down and across blocks', async () => {
    const history = new HistoryService(new GitCli(directRunner()));
    const { historyVersion } = await git.read(root);
    const { rows } = await history.page(root, historyVersion, 3000, 600);
    const expected = sh('log', '--all', '--date-order', '--skip=3000', '-600', '--format=%H %an %at %s').split('\n');
    expect(rows.map((row) => `${row.hash} ${row.authorName} ${row.authorTime} ${row.subject}`)).toEqual(expected);
  });

  it('rebuilds when the version changes and reports the version it was built for', async () => {
    const history = new HistoryService(new GitCli(directRunner()));
    const before = await git.read(root);
    const old = await history.page(root, before.historyVersion, 0, 5);
    sh('commit', '--allow-empty', '-qm', 'Newest');
    const after = await git.read(root);
    expect(after.historyVersion).not.toBe(before.historyVersion);
    const fresh = await history.page(root, after.historyVersion, 0, 5);
    expect(fresh.version).toBe(after.historyVersion);
    expect(fresh.rows[0]?.subject).toBe('Newest');
    expect(fresh.rows[1]?.hash).toBe(old.rows.find((row) => row.subject !== 'Newest')?.hash ?? fresh.rows[1]?.hash);
    // A window still on the old version gets the current history and its version.
    const stale = await history.page(root, before.historyVersion, 0, 5);
    expect(stale.version).toBe(after.historyVersion);
  });
});
