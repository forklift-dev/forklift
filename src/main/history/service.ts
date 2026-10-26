import { Reference, Repository } from '@axosoft/nodegit';
import { GraphLayout, type GraphLayoutState, type GraphRowLayout } from '../../shared/graph';
import { fuzzyFilter } from '../../shared/fuzzy';
import type { FoundCommit, HistoryFilter, HistoryPage, HistoryRow, HistorySearch, SearchResult } from '../../shared/history';
import type { GitCli } from '../git/cli';
import { historyVersion, readStashes } from '../git/service';
import { CommitTable } from './commits';
import type { HistorySnapshot, HistoryStore } from './store';

export const MAX_PAGE = 1000;
const MAX_MATCHES = 2000;
/** Rows between saved layout states: a page is laid out again from the nearest one before it. */
const CHECKPOINT = 256;
/** Rows whose authors, dates and subjects are read together (and kept or dropped together). */
const BLOCK = 256;
/** Blocks of commit details kept; the farthest from the last one asked for are dropped first. */
const MAX_BLOCKS = 256;
/** A commit's details, one line each, separated by US (subjects are single lines). */
const DETAILS_FORMAT = '--format=%H%x1f%an%x1f%ae%x1f%at%x1f%s';
/** Histories at least this long are saved for the next run (shorter ones are read again in no time). */
const SAVE_FROM_ROWS = 20_000;

/** git's summary: the first paragraph of the message on one line. */
export function summary(message: string): string {
  return (message.split(/\r?\n\s*\r?\n/)[0] ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

interface CommitDetails {
  hash: string;
  authorName: string;
  authorEmail: string;
  authorTime: number;
  subject: string;
}

interface StashRow extends CommitDetails {
  base: string;
  index: number;
}

/** A commit git did not describe (it went away meanwhile): shown without details rather than failing the page. */
const missing = (hash: string): CommitDetails => ({ hash, authorName: '', authorEmail: '', authorTime: 0, subject: '' });

function parseDetails(line: string): CommitDetails | null {
  const [hash = '', authorName = '', authorEmail = '', time = '0', subject = ''] = line.split('\x1f');
  return hash.length >= 40 ? { hash, authorName, authorEmail, authorTime: Number(time), subject } : null;
}

/**
 * One repository's history at one version. Its shape (commits and parents, in `--date-order`) comes from a
 * `git rev-list` stream as far as asked (git then keeps reading in the background); authors, dates and subjects
 * are read only for the rows shown, a block at a time — decoding every commit of a huge history for them is
 * what takes long (linux: 2 s for the shape, 11 s with the details). The graph is not stored either: every
 * CHECKPOINT rows the layout's state is saved (reading moves it on without drawing), and a page is laid out
 * again from the nearest saved state before it.
 */
class HistoryCache {
  /** Shas and parents of the rows, as bytes (a string per commit would take hundreds of MB in linux). */
  private commits = new CommitTable();
  /** Stash rows by row index, drawn above the commit they were made on (their details are known up front). */
  private readonly stashAt = new Map<number, StashRow>();
  /** Details of blocks of BLOCK rows, read when shown. */
  private readonly blocks = new Map<number, Promise<CommitDetails[]>>();
  private lastBlock = 0;
  /** Every commit's subject, read once for the finder. */
  private subjectList: Promise<Map<string, string>> | null = null;
  private checkpoints: GraphLayoutState[] = [];
  private readonly layout = new GraphLayout();
  complete = false;
  private failure: unknown = null;
  private reading: Promise<void> | null = null;
  private readonly waiters: Array<{ count: number; resolve(): void; reject(error: unknown): void }> = [];
  private readonly abort = new AbortController();

  constructor(
    readonly version: string,
    readonly filterKey: string,
    /** The revisions walked, for `git log` searches over exactly the same commits. */
    readonly revisions: string[],
    private readonly read: (onLine: (line: string) => void, signal: AbortSignal) => Promise<void>,
    /** Details of commits, in the order given. */
    private readonly details: (shas: string[], signal: AbortSignal) => Promise<CommitDetails[]>,
    /** Every commit's subject by sha. */
    private readonly readSubjects: (signal: AbortSignal) => Promise<Map<string, string>>,
    /** Stashes by the commit they were made on; each is placed right above it. */
    private readonly stashesByBase: Map<string, StashRow[]> = new Map(),
    /** Told once the whole history has been read. */
    private readonly onComplete?: (cache: HistoryCache) => void,
  ) {}

  /** A history saved by an earlier run, complete without reading. */
  static restore(snapshot: HistorySnapshot, details: HistoryCache['details'], readSubjects: HistoryCache['readSubjects']): HistoryCache {
    const cache = new HistoryCache(snapshot.version, snapshot.filterKey, snapshot.revisions, async () => {}, details, readSubjects);
    cache.commits = snapshot.commits;
    for (const [row, stash] of snapshot.stashes) cache.stashAt.set(row, stash);
    cache.checkpoints = snapshot.checkpoints;
    cache.complete = true;
    return cache;
  }

  /** What restore needs (the history must be complete). */
  snapshot(): HistorySnapshot {
    return {
      version: this.version,
      filterKey: this.filterKey,
      revisions: this.revisions,
      commits: this.commits,
      stashes: [...this.stashAt],
      checkpoints: this.checkpoints,
    };
  }

  get length(): number {
    return this.commits.length;
  }

  /** The row of a commit read so far, or -1. */
  find(sha: string): number {
    return this.commits.find(sha);
  }

  /** Resolves once at least `count` rows exist or the history has ended. */
  ensure(count: number): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.complete || this.length >= count) return Promise.resolve();
    this.reading ??= this.read((line) => this.addLine(line), this.abort.signal).then(
      () => this.finish(null),
      (error: unknown) => this.finish(error),
    );
    return new Promise((resolve, reject) => this.waiters.push({ count, resolve, reject }));
  }

  /** Stops reading (a newer version or filter replaced this one). */
  dispose(): void {
    this.abort.abort();
  }

  /** Rows `start…end` with their details and graph, laid out again from the nearest saved state. */
  async rows(start: number, end: number): Promise<HistoryRow[]> {
    end = Math.min(end, this.length);
    if (start >= end) return [];
    const details = await this.detailsOf(start, end);
    const from = Math.floor(start / CHECKPOINT);
    const layout = GraphLayout.from(this.checkpoints[from]!);
    const rows: HistoryRow[] = [];
    for (let i = from * CHECKPOINT; i < end; i++) {
      const graph = layout.next(this.commits.hash(i), this.commits.parents(i));
      if (i >= start) rows.push(this.row(i, details[i - start]!, graph));
    }
    return rows;
  }

  hash(row: number): string {
    return this.commits.hash(row);
  }

  isStash(row: number): boolean {
    return this.stashAt.has(row);
  }

  /** Every commit's subject by sha (read once, on first use: the whole history's details are slow to read). */
  subjects(): Promise<Map<string, string>> {
    return (this.subjectList ??= this.readSubjects(this.abort.signal));
  }

  /** Details of rows `start…end` (stash rows from the stash list, the rest by block). */
  async detailsOf(start: number, end: number): Promise<CommitDetails[]> {
    const first = Math.floor(start / BLOCK);
    const last = Math.floor((end - 1) / BLOCK);
    this.lastBlock = first;
    const blocks = await Promise.all(Array.from({ length: last - first + 1 }, (_, i) => this.block(first + i)));
    return blocks.flat().slice(start - first * BLOCK, end - first * BLOCK);
  }

  private block(index: number): Promise<CommitDetails[]> {
    let block = this.blocks.get(index);
    if (!block) {
      const start = index * BLOCK;
      const end = Math.min(this.length, start + BLOCK);
      const rows = Array.from({ length: end - start }, (_, i) => start + i);
      const shas = rows.filter((row) => !this.stashAt.has(row)).map((row) => this.commits.hash(row));
      block = this.details(shas, this.abort.signal).then((found) => {
        const bySha = new Map(found.map((details) => [details.hash, details]));
        return rows.map((row) => {
          const hash = this.commits.hash(row);
          return this.stashAt.get(row) ?? bySha.get(hash) ?? missing(hash);
        });
      });
      // A block of a history still being read may be short: it is read again once more rows exist.
      if (end - start === BLOCK || this.complete) this.blocks.set(index, block);
      block.catch(() => this.blocks.get(index) === block && this.blocks.delete(index));
      this.evict();
    }
    return block;
  }

  private evict(): void {
    while (this.blocks.size > MAX_BLOCKS) {
      let farthest = -1;
      for (const index of this.blocks.keys()) if (farthest < 0 || Math.abs(index - this.lastBlock) > Math.abs(farthest - this.lastBlock)) farthest = index;
      this.blocks.delete(farthest);
    }
  }

  private row(i: number, details: CommitDetails, graph: GraphRowLayout): HistoryRow {
    const stash = this.stashAt.get(i);
    return {
      hash: this.commits.hash(i),
      parents: this.commits.parents(i),
      authorName: details.authorName,
      authorEmail: details.authorEmail,
      authorTime: details.authorTime,
      subject: details.subject,
      graph,
      ...(stash && { stash: { index: stash.index } }),
    };
  }

  private addLine(line: string): void {
    // "sha parent parent…" as rev-list --parents prints it.
    const space = line.indexOf(' ');
    const hash = space < 0 ? line : line.slice(0, space);
    if (hash.length < 40) return;
    // A SHA-256 repository: its shas are 32 bytes.
    if (!this.length && hash.length !== this.commits.width * 2) this.commits = new CommitTable(hash.length / 2);
    for (const stash of this.stashesByBase.get(hash) ?? []) {
      this.stashAt.set(this.length, stash);
      this.append(stash.hash, stash.base);
    }
    this.append(hash, space < 0 ? '' : line.slice(space + 1));
    // Only when a waiter can be served: this runs for every commit.
    if (this.waiters.length && this.length >= this.waiters[0]!.count) this.wake();
  }

  private append(hash: string, parents: string): void {
    const row = this.length;
    if (row % CHECKPOINT === 0) this.checkpoints.push(this.layout.state());
    this.layout.advance(hash, parents ? parents.split(' ') : []);
    this.commits.add(hash, parents);
  }

  private finish(error: unknown): void {
    if (error && !this.abort.signal.aborted) this.failure = error;
    this.complete = true;
    this.commits.trim();
    this.wake();
    if (!error) this.onComplete?.(this);
  }

  private wake(): void {
    this.waiters.sort((a, b) => a.count - b.count);
    while (this.waiters.length && (this.complete || this.length >= this.waiters[0]!.count)) {
      const waiter = this.waiters.shift()!;
      if (this.failure) waiter.reject(this.failure);
      else waiter.resolve();
    }
  }
}

/**
 * Commit history with graph layout, served to windows page by page instead of being replicated:
 * a status refresh never copies it, and a large repository is only laid out where it is looked at.
 */
export class HistoryService {
  private readonly caches = new Map<string, Promise<HistoryCache>>();

  constructor(
    private readonly git: GitCli,
    /** Saves large histories between runs; without it every run reads them again. */
    private readonly store?: Pick<HistoryStore, 'load' | 'save'>,
  ) {}

  /**
   * Rows `start…start+count` of the repository's history. `version` is what the window last saw in
   * RepoData; a different cached version is rebuilt (the page then reports the version it was built for).
   */
  async page(root: string, version: string, start: number, count: number, filter: HistoryFilter = { solo: [], hidden: [] }): Promise<HistoryPage> {
    const cache = await this.cache(root, version, filter);
    await cache.ensure(start + count);
    const rows = await cache.rows(start, start + count);
    return { version: cache.version, start, rows, loaded: cache.length, complete: cache.complete };
  }

  /** Row index of a commit (reading as far as needed), or -1 when it is not in this history. */
  async locate(root: string, version: string, filter: HistoryFilter, sha: string): Promise<number> {
    const cache = await this.cache(root, version, filter);
    while (cache.find(sha) < 0 && !cache.complete) await cache.ensure(cache.length + 5000);
    return cache.find(sha);
  }

  /** Commits for the finder: sha prefix, or the subject matched fuzzily; best first. */
  async find(root: string, version: string, filter: HistoryFilter, text: string, limit = 30): Promise<FoundCommit[]> {
    const cache = await this.cache(root, version, filter);
    await cache.ensure(Infinity);
    const query = text.trim();
    if (!query) return [];
    const commits: number[] = [];
    for (let row = 0; row < cache.length; row++) if (!cache.isStash(row)) commits.push(row);
    const hits: Array<{ row: number; positions: number[] }> = [];
    if (/^[0-9a-f]{4,40}$/i.test(query)) {
      const prefix = query.toLowerCase();
      for (const row of commits) {
        if (hits.length >= limit) break;
        if (cache.hash(row).startsWith(prefix)) hits.push({ row, positions: [] });
      }
    }
    const subjects = await cache.subjects();
    for (const { item, positions } of fuzzyFilter(query, commits, (row) => subjects.get(cache.hash(row)) ?? '', limit - hits.length)) {
      if (!hits.some((hit) => hit.row === item)) hits.push({ row: item, positions });
    }
    // Authors and dates of the few found, from their blocks.
    return Promise.all(
      hits.map(async ({ row, positions }) => {
        const [details = missing(cache.hash(row))] = await cache.detailsOf(row, row + 1);
        return { sha: details.hash, subject: details.subject, authorName: details.authorName, authorTime: details.authorTime, positions };
      }),
    );
  }

  /** Commits matching a search, as row indices of the same history (message, author, file and content via git log). */
  async search(root: string, version: string, filter: HistoryFilter, query: HistorySearch): Promise<SearchResult> {
    const cache = await this.cache(root, version, filter);
    await cache.ensure(Infinity);
    const text = query.text.trim();
    if (!text) return { indices: [], truncated: false };
    let indices: number[];
    if (query.field === 'sha') {
      const prefix = text.toLowerCase();
      indices = [];
      for (let row = 0; row < cache.length; row++) if (cache.hash(row).startsWith(prefix)) indices.push(row);
    } else {
      const pseudo = cache.revisions.filter((rev) => rev.startsWith('--'));
      const refs = cache.revisions.filter((rev) => !rev.startsWith('--'));
      // With no revisions at all, git log would fall back to HEAD.
      if (!pseudo.length && !refs.length) return { indices: [], truncated: false };
      const args = ['log', '--format=%H', ...pseudo, '--stdin'];
      if (query.field === 'message') args.push('-i', '--fixed-strings', `--grep=${text}`);
      else if (query.field === 'author') args.push('-i', '--fixed-strings', `--author=${text}`);
      else if (query.field === 'content') args.push(`-S${text}`);
      args.push('--');
      if (query.field === 'file') args.push(`:(icase,glob)**/*${text.replace(/[*?[\]]/g, '\\$&')}*`);
      const { stdout } = await this.git.exec(args, { cwd: root, readOnly: true, input: refs.length ? `${refs.join('\n')}\n` : '', timeoutMs: 120_000 });
      indices = stdout
        .split('\n')
        .map((sha) => cache.find(sha))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b);
    }
    return { indices: indices.slice(0, MAX_MATCHES), truncated: indices.length > MAX_MATCHES };
  }

  /** Drops a closed repository's history. */
  forget(root: string): void {
    void this.caches.get(root)?.then((cache) => cache.dispose(), () => {});
    this.caches.delete(root);
  }

  private async cache(root: string, version: string, filter: HistoryFilter): Promise<HistoryCache> {
    const filterKey = JSON.stringify([[...filter.solo].sort(), [...filter.hidden].sort()]);
    let pending = this.caches.get(root);
    const cache = pending ? await pending.catch(() => null) : null;
    if (cache && cache.version === version && cache.filterKey === filterKey) return cache;
    cache?.dispose();
    pending = this.build(root, filter, filterKey);
    this.caches.set(root, pending);
    return pending;
  }

  private async build(root: string, filter: HistoryFilter, filterKey: string): Promise<HistoryCache> {
    const repo = await Repository.open(root);
    const stashes = filter.solo.length ? [] : await readStashes(repo);
    const version = await historyVersion(repo);
    const stashesByBase = new Map<string, StashRow[]>();
    for (const stash of stashes) {
      const commit = await repo.getCommit(stash.sha);
      const author = commit.author();
      // Only the base as parent: the index and untracked-files commits of a stash are its internals.
      const row: StashRow = { hash: stash.sha, base: stash.base, authorName: author.name(), authorEmail: author.email(), authorTime: author.when().time(), subject: stash.message, index: stash.index };
      stashesByBase.set(stash.base, [...(stashesByBase.get(stash.base) ?? []), row]);
    }
    const revisions: string[] = [];
    if (filter.solo.length) {
      for (const name of filter.solo) {
        if (await Reference.lookup(repo, name).then(() => true, () => false)) revisions.push(name);
      }
    } else if (filter.hidden.length) {
      // Each ref but the hidden ones: commits only they reach drop out, shared history stays.
      const hidden = new Set(filter.hidden);
      for (const ref of await repo.getReferences()) {
        if (ref.isSymbolic() || !(ref.isBranch() || ref.isRemote() || ref.isTag()) || hidden.has(ref.name()) || revisions.includes(ref.name())) continue;
        revisions.push(ref.name());
      }
      const headRef = repo.headUnborn() ? null : await repo.head();
      if (headRef && (repo.headDetached() || !hidden.has(headRef.name()))) revisions.push('HEAD');
    } else {
      // A detached HEAD is not under any ref. Pseudo-options without matches (a new repository) add nothing.
      if (!repo.headUnborn()) revisions.push('HEAD');
      revisions.push('--branches', '--remotes', '--tags');
    }
    const pseudo = revisions.filter((rev) => rev.startsWith('--'));
    const refs = revisions.filter((rev) => !rev.startsWith('--'));
    const input = refs.length ? `${refs.join('\n')}\n` : '';
    // Nothing to walk: git would fall back to HEAD.
    const nothing = !pseudo.length && !refs.length;
    const read = async (onLine: (line: string) => void, signal: AbortSignal) => {
      if (nothing) return;
      await this.git.exec(['rev-list', '--date-order', '--parents', ...pseudo, '--stdin'], { cwd: root, readOnly: true, input, signal, onStdoutLine: onLine, streamOnly: true });
    };
    const details = async (shas: string[], signal: AbortSignal) => {
      if (!shas.length) return [];
      const found: CommitDetails[] = [];
      // --no-walk=unsorted: exactly these commits, in this order.
      await this.git.exec(['log', '--no-walk=unsorted', DETAILS_FORMAT, '--stdin'], {
        cwd: root,
        readOnly: true,
        input: `${shas.join('\n')}\n`,
        signal,
        onStdoutLine: (line) => {
          const parsed = parseDetails(line);
          if (parsed) found.push(parsed);
        },
        streamOnly: true,
      });
      return found;
    };
    const readSubjects = async (signal: AbortSignal) => {
      const subjects = new Map<string, string>();
      if (nothing) return subjects;
      await this.git.exec(['log', '--format=%H%x1f%s', ...pseudo, '--stdin'], {
        cwd: root,
        readOnly: true,
        input,
        signal,
        onStdoutLine: (line) => subjects.set(line.slice(0, line.indexOf('\x1f')), line.slice(line.indexOf('\x1f') + 1)),
        streamOnly: true,
      });
      return subjects;
    };
    const saved = await this.store?.load(root, version, filterKey).catch(() => null);
    if (saved) return HistoryCache.restore(saved, details, readSubjects);
    const save = (cache: HistoryCache) => {
      if (!this.store || cache.length < SAVE_FROM_ROWS) return;
      this.store.save(root, cache.snapshot()).catch((error: unknown) => console.error('[history] could not save the history:', error));
    };
    return new HistoryCache(version, filterKey, revisions, read, details, readSubjects, stashesByBase, save);
  }
}
