import { Reference, Repository, type Revwalk } from '@axosoft/nodegit';
import { GraphLayout } from '../../shared/graph';
import { fuzzyFilter } from '../../shared/fuzzy';
import type { FoundCommit, HistoryFilter, HistoryPage, HistoryRow, HistorySearch, SearchResult } from '../../shared/history';
import type { GitCli } from '../git/cli';
import { SORT } from '../git/libgit2';
import { historyVersion, readStashes, WALK_GLOBS } from '../git/service';

/** Commits read per walk step; the first page of a large repository costs the topological sort anyway. */
const CHUNK = 2000;
export const MAX_PAGE = 1000;
const MAX_MATCHES = 2000;

/** git's summary: the first paragraph of the message on one line. */
export function summary(message: string): string {
  return (message.split(/\r?\n\s*\r?\n/)[0] ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

/** One repository's history at one version: walked lazily, laid out as it grows. */
class HistoryCache {
  readonly rows: HistoryRow[] = [];
  /** Row index by commit sha. */
  readonly index = new Map<string, number>();
  complete = false;
  private readonly layout = new GraphLayout();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly version: string,
    readonly filterKey: string,
    /** The revisions walked, for `git log` searches over exactly the same commits. */
    readonly revisions: string[],
    private readonly walk: Revwalk,
    /** Stash rows by the commit they were made on; each is placed right above it. */
    private readonly stashesByBase: Map<string, HistoryRow[]> = new Map(),
  ) {}

  /** Walks until at least `count` rows exist or history ends; concurrent calls run one after another. */
  ensure(count: number): Promise<void> {
    const step = async () => {
      while (!this.complete && this.rows.length < count) {
        const commits = await this.walk.commitWalk(CHUNK, { returnPlainObjects: true });
        for (const commit of commits) {
          for (const stash of this.stashesByBase.get(commit.sha) ?? []) {
            this.index.set(stash.hash, this.rows.length);
            this.rows.push({ ...stash, graph: this.layout.next(stash.hash, stash.parents) });
          }
          this.index.set(commit.sha, this.rows.length);
          this.rows.push({
            hash: commit.sha,
            parents: commit.parents,
            authorName: commit.author.name,
            authorEmail: commit.author.email,
            authorTime: Math.floor(commit.author.date / 1000),
            subject: summary(commit.message),
            graph: this.layout.next(commit.sha, commit.parents),
          });
        }
        if (commits.length < CHUNK) this.complete = true;
      }
    };
    const run = this.queue.then(step);
    this.queue = run.catch(() => {});
    return run;
  }
}

/**
 * Commit history with graph layout, served to windows page by page instead of being replicated:
 * a status refresh never copies it, and a large repository is only walked as far as it is scrolled.
 */
export class HistoryService {
  private readonly caches = new Map<string, Promise<HistoryCache>>();

  constructor(private readonly git?: GitCli) {}

  /**
   * Rows `start…start+count` of the repository's history. `version` is what the window last saw in
   * RepoData; a different cached version is rebuilt (the page then reports the version it was built for).
   */
  async page(root: string, version: string, start: number, count: number, filter: HistoryFilter = { solo: [], hidden: [] }): Promise<HistoryPage> {
    const cache = await this.cache(root, version, filter);
    await cache.ensure(start + count);
    return { version: cache.version, start, rows: cache.rows.slice(start, start + count), loaded: cache.rows.length, complete: cache.complete };
  }

  /** Row index of a commit (walking as far as needed), or -1 when it is not in this history. */
  async locate(root: string, version: string, filter: HistoryFilter, sha: string): Promise<number> {
    const cache = await this.cache(root, version, filter);
    while (!cache.index.has(sha) && !cache.complete) await cache.ensure(cache.rows.length + 5000);
    return cache.index.get(sha) ?? -1;
  }

  /** Commits for the finder: sha prefix, or the subject matched fuzzily; best first. */
  async find(root: string, version: string, filter: HistoryFilter, text: string, limit = 30): Promise<FoundCommit[]> {
    const cache = await this.cache(root, version, filter);
    await cache.ensure(Infinity);
    const query = text.trim();
    if (!query) return [];
    const commits = cache.rows.filter((row) => !row.stash);
    const found: FoundCommit[] = [];
    if (/^[0-9a-f]{4,40}$/i.test(query)) {
      const prefix = query.toLowerCase();
      for (const row of commits) if (row.hash.startsWith(prefix) && found.length < limit) found.push(foundCommit(row, []));
    }
    for (const { item, positions } of fuzzyFilter(query, commits, (row) => row.subject, limit - found.length)) {
      if (!found.some((commit) => commit.sha === item.hash)) found.push(foundCommit(item, positions));
    }
    return found;
  }

  /** Commits matching a search, as row indices of the same history (message, author, file and content via git log). */
  async search(root: string, version: string, filter: HistoryFilter, query: HistorySearch): Promise<SearchResult> {
    const cache = await this.cache(root, version, filter);
    await cache.ensure(Infinity);
    const text = query.text.trim();
    if (!text) return { indices: [], truncated: false };
    let shas: string[];
    if (query.field === 'sha') {
      const prefix = text.toLowerCase();
      shas = cache.rows.filter((row) => row.hash.startsWith(prefix)).map((row) => row.hash);
    } else {
      if (!this.git) throw new Error('Searching needs the git CLI');
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
      shas = stdout.split('\n').filter(Boolean);
    }
    const indices = shas.map((sha) => cache.index.get(sha)).filter((index): index is number => index !== undefined).sort((a, b) => a - b);
    return { indices: indices.slice(0, MAX_MATCHES), truncated: indices.length > MAX_MATCHES };
  }

  /** Drops a closed repository's history. */
  forget(root: string): void {
    this.caches.delete(root);
  }

  private async cache(root: string, version: string, filter: HistoryFilter): Promise<HistoryCache> {
    const filterKey = JSON.stringify([[...filter.solo].sort(), [...filter.hidden].sort()]);
    let pending = this.caches.get(root);
    const cache = pending ? await pending.catch(() => null) : null;
    if (cache && cache.version === version && cache.filterKey === filterKey) return cache;
    pending = this.build(root, filter, filterKey);
    this.caches.set(root, pending);
    return pending;
  }

  private async build(root: string, filter: HistoryFilter, filterKey: string): Promise<HistoryCache> {
    const repo = await Repository.open(root);
    const stashes = filter.solo.length ? [] : await readStashes(repo);
    const version = await historyVersion(repo);
    const stashesByBase = new Map<string, HistoryRow[]>();
    for (const stash of stashes) {
      const commit = await repo.getCommit(stash.sha);
      const author = commit.author();
      const row: HistoryRow = {
        hash: stash.sha,
        // Only the base: the index and untracked-files commits of a stash are its internals.
        parents: [stash.base],
        authorName: author.name(),
        authorEmail: author.email(),
        authorTime: author.when().time(),
        subject: stash.message,
        graph: { column: 0, color: 0, edges: [], width: 1 },
        stash: { index: stash.index },
      };
      stashesByBase.set(stash.base, [...(stashesByBase.get(stash.base) ?? []), row]);
    }
    const walk = repo.createRevWalk();
    walk.sorting(SORT.TOPOLOGICAL, SORT.TIME);
    const revisions: string[] = [];
    const push = (name: string) => {
      walk.pushRef(name);
      revisions.push(name);
    };
    if (filter.solo.length) {
      for (const name of filter.solo) {
        if (await Reference.lookup(repo, name).then(() => true, () => false)) push(name);
      }
    } else if (filter.hidden.length) {
      // Each ref but the hidden ones: commits only they reach drop out, shared history stays.
      const hidden = new Set(filter.hidden);
      for (const ref of await repo.getReferences()) {
        if (ref.isSymbolic() || !(ref.isBranch() || ref.isRemote() || ref.isTag()) || hidden.has(ref.name()) || revisions.includes(ref.name())) continue;
        push(ref.name());
      }
      const headRef = repo.headUnborn() ? null : await repo.head();
      if (headRef && (repo.headDetached() || !hidden.has(headRef.name()))) {
        walk.pushHead();
        revisions.push('HEAD');
      }
    } else {
      // A detached HEAD is not under any ref. Globs without matches (a new repository) push nothing.
      if (!repo.headUnborn()) {
        walk.pushHead();
        revisions.push('HEAD');
      }
      for (const glob of WALK_GLOBS) walk.pushGlob(glob);
      // Pseudo-options go on the command line (see search), the explicit revisions through stdin.
      revisions.push('--branches', '--remotes', '--tags');
    }
    return new HistoryCache(version, filterKey, revisions, walk, stashesByBase);
  }
}

const foundCommit = (row: HistoryRow, positions: number[]): FoundCommit => ({ sha: row.hash, subject: row.subject, authorName: row.authorName, authorTime: row.authorTime, positions });
