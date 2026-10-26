import { Reference, Repository } from '@axosoft/nodegit';
import { GraphLayout, type GraphLayoutState, type GraphRowLayout } from '../../shared/graph';
import { fuzzyFilter } from '../../shared/fuzzy';
import type { FoundCommit, HistoryFilter, HistoryPage, HistoryRow, HistorySearch, SearchResult } from '../../shared/history';
import type { GitCli } from '../git/cli';
import { historyVersion, readStashes } from '../git/service';

export const MAX_PAGE = 1000;
const MAX_MATCHES = 2000;
/** Rows between saved layout states: a page is laid out again from the nearest one before it. */
const CHECKPOINT = 256;
/** Fields of a commit in the `git log` stream: one line each, separated by US (subjects are single lines). */
const LOG_FORMAT = '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s';

/** git's summary: the first paragraph of the message on one line. */
export function summary(message: string): string {
  return (message.split(/\r?\n\s*\r?\n/)[0] ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

interface StashRow {
  hash: string;
  base: string;
  authorName: string;
  authorEmail: string;
  authorTime: number;
  subject: string;
  index: number;
}

/**
 * One repository's history at one version, read from a `git log --date-order` stream as far as asked (git
 * then keeps reading in the background). Commits are kept column by column (no object per row) and the graph
 * is not stored at all: every CHECKPOINT rows the layout's state is saved (reading moves it on without drawing), and a page is laid out again from
 * the nearest saved state before it — a history of millions of commits fits in a few hundred MB.
 */
class HistoryCache {
  private readonly hashes: string[] = [];
  /** Parent hashes joined by spaces ('' for a root commit). */
  private readonly parentLists: string[] = [];
  /** Index into `authors` ("name\0email"), shared by all commits of one author. */
  private readonly authorIds: number[] = [];
  private readonly authors: string[] = [];
  private readonly authorIndex = new Map<string, number>();
  private readonly times: number[] = [];
  private readonly subjects: string[] = [];
  /** Stash rows by row index (the stash index), drawn above the commit they were made on. */
  private readonly stashAt = new Map<number, number>();
  /** Row index by commit sha. */
  readonly index = new Map<string, number>();
  private readonly checkpoints: GraphLayoutState[] = [];
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
    /** Stashes by the commit they were made on; each is placed right above it. */
    private readonly stashesByBase: Map<string, StashRow[]> = new Map(),
  ) {}

  get length(): number {
    return this.hashes.length;
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

  /** Rows `start…end` with their graph, laid out again from the nearest saved state. */
  rows(start: number, end: number): HistoryRow[] {
    end = Math.min(end, this.length);
    if (start >= end) return [];
    const from = Math.floor(start / CHECKPOINT);
    const layout = GraphLayout.from(this.checkpoints[from]!);
    const rows: HistoryRow[] = [];
    for (let i = from * CHECKPOINT; i < end; i++) {
      const graph = layout.next(this.hashes[i]!, this.parents(i));
      if (i >= start) rows.push(this.row(i, graph));
    }
    return rows;
  }

  hash(row: number): string {
    return this.hashes[row]!;
  }

  subject(row: number): string {
    return this.subjects[row]!;
  }

  isStash(row: number): boolean {
    return this.stashAt.has(row);
  }

  /** The commit without its graph (for the finder). */
  commit(row: number): Pick<HistoryRow, 'hash' | 'subject' | 'authorName' | 'authorTime'> {
    return { hash: this.hashes[row]!, subject: this.subjects[row]!, authorName: this.authors[this.authorIds[row]!]!.split('\0')[0]!, authorTime: this.times[row]! };
  }

  private row(i: number, graph: GraphRowLayout): HistoryRow {
    const [authorName = '', authorEmail = ''] = this.authors[this.authorIds[i]!]!.split('\0');
    const stash = this.stashAt.get(i);
    return {
      hash: this.hashes[i]!,
      parents: this.parents(i),
      authorName,
      authorEmail,
      authorTime: this.times[i]!,
      subject: this.subjects[i]!,
      graph,
      ...(stash !== undefined && { stash: { index: stash } }),
    };
  }

  private parents(i: number): string[] {
    const list = this.parentLists[i]!;
    return list ? list.split(' ') : [];
  }

  private addLine(line: string): void {
    const [hash, parents = '', name = '', email = '', time = '0', subject = ''] = line.split('\x1f');
    if (!hash || hash.length < 40) return;
    for (const stash of this.stashesByBase.get(hash) ?? []) {
      this.stashAt.set(this.length, stash.index);
      this.append(stash.hash, stash.base, stash.authorName, stash.authorEmail, stash.authorTime, stash.subject);
    }
    this.append(hash, parents, name, email, Number(time), subject);
    // Only when a waiter can be served: this runs for every commit.
    if (this.waiters.length && this.length >= this.waiters[0]!.count) this.wake();
  }

  private append(hash: string, parents: string, name: string, email: string, time: number, subject: string): void {
    const row = this.length;
    if (row % CHECKPOINT === 0) this.checkpoints.push(this.layout.state());
    this.layout.advance(hash, parents ? parents.split(' ') : []);
    const key = `${name}\0${email}`;
    let author = this.authorIndex.get(key);
    if (author === undefined) {
      author = this.authors.push(key) - 1;
      this.authorIndex.set(key, author);
    }
    this.index.set(hash, row);
    this.hashes.push(hash);
    this.parentLists.push(parents);
    this.authorIds.push(author);
    this.times.push(time);
    this.subjects.push(subject);
  }

  private finish(error: unknown): void {
    if (error && !this.abort.signal.aborted) this.failure = error;
    this.complete = true;
    this.wake();
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

  constructor(private readonly git: GitCli) {}

  /**
   * Rows `start…start+count` of the repository's history. `version` is what the window last saw in
   * RepoData; a different cached version is rebuilt (the page then reports the version it was built for).
   */
  async page(root: string, version: string, start: number, count: number, filter: HistoryFilter = { solo: [], hidden: [] }): Promise<HistoryPage> {
    const cache = await this.cache(root, version, filter);
    await cache.ensure(start + count);
    return { version: cache.version, start, rows: cache.rows(start, start + count), loaded: cache.length, complete: cache.complete };
  }

  /** Row index of a commit (reading as far as needed), or -1 when it is not in this history. */
  async locate(root: string, version: string, filter: HistoryFilter, sha: string): Promise<number> {
    const cache = await this.cache(root, version, filter);
    while (!cache.index.has(sha) && !cache.complete) await cache.ensure(cache.length + 5000);
    return cache.index.get(sha) ?? -1;
  }

  /** Commits for the finder: sha prefix, or the subject matched fuzzily; best first. */
  async find(root: string, version: string, filter: HistoryFilter, text: string, limit = 30): Promise<FoundCommit[]> {
    const cache = await this.cache(root, version, filter);
    await cache.ensure(Infinity);
    const query = text.trim();
    if (!query) return [];
    const commits: number[] = [];
    for (let row = 0; row < cache.length; row++) if (!cache.isStash(row)) commits.push(row);
    const found: FoundCommit[] = [];
    if (/^[0-9a-f]{4,40}$/i.test(query)) {
      const prefix = query.toLowerCase();
      for (const row of commits) {
        if (found.length >= limit) break;
        if (cache.hash(row).startsWith(prefix)) found.push(foundCommit(cache.commit(row), []));
      }
    }
    for (const { item, positions } of fuzzyFilter(query, commits, (row) => cache.subject(row), limit - found.length)) {
      if (!found.some((commit) => commit.sha === cache.hash(item))) found.push(foundCommit(cache.commit(item), positions));
    }
    return found;
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
        .map((sha) => cache.index.get(sha))
        .filter((index): index is number => index !== undefined)
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
    const read = async (onLine: (line: string) => void, signal: AbortSignal) => {
      // Nothing to walk: git log would fall back to HEAD.
      if (!pseudo.length && !refs.length) return;
      await this.git.exec(['log', '--date-order', LOG_FORMAT, ...pseudo, '--stdin'], {
        cwd: root,
        readOnly: true,
        input: refs.length ? `${refs.join('\n')}\n` : '',
        signal,
        onStdoutLine: onLine,
        streamOnly: true,
      });
    };
    return new HistoryCache(version, filterKey, revisions, read, stashesByBase);
  }
}

const foundCommit = (row: Pick<HistoryRow, 'hash' | 'subject' | 'authorName' | 'authorTime'>, positions: number[]): FoundCommit => ({
  sha: row.hash,
  subject: row.subject,
  authorName: row.authorName,
  authorTime: row.authorTime,
  positions,
});
