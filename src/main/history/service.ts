import { Repository, type Revwalk } from '@axosoft/nodegit';
import { GraphLayout } from '../../shared/graph';
import type { HistoryPage, HistoryRow } from '../../shared/history';
import { SORT } from '../git/libgit2';
import { historyVersion, readStashes, WALK_GLOBS } from '../git/service';

/** Commits read per walk step; the first page of a large repository costs the topological sort anyway. */
const CHUNK = 2000;
export const MAX_PAGE = 1000;

/** git's summary: the first paragraph of the message on one line. */
export function summary(message: string): string {
  return (message.split(/\r?\n\s*\r?\n/)[0] ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

/** One repository's history at one version: walked lazily, laid out as it grows. */
class HistoryCache {
  readonly rows: HistoryRow[] = [];
  complete = false;
  private readonly layout = new GraphLayout();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly version: string,
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
            this.rows.push({ ...stash, graph: this.layout.next(stash.hash, stash.parents) });
          }
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

  /**
   * Rows `start…start+count` of the repository's history. `version` is what the window last saw in
   * RepoData; a different cached version is rebuilt (the page then reports the version it was built for).
   */
  async page(root: string, version: string, start: number, count: number): Promise<HistoryPage> {
    let pending = this.caches.get(root);
    let cache = pending ? await pending.catch(() => null) : null;
    if (!cache || cache.version !== version) {
      pending = this.build(root);
      this.caches.set(root, pending);
      cache = await pending;
    }
    await cache.ensure(start + count);
    return { version: cache.version, start, rows: cache.rows.slice(start, start + count), loaded: cache.rows.length, complete: cache.complete };
  }

  /** Drops a closed repository's history. */
  forget(root: string): void {
    this.caches.delete(root);
  }

  private async build(root: string): Promise<HistoryCache> {
    const repo = await Repository.open(root);
    const stashes = await readStashes(repo);
    const version = await historyVersion(repo, stashes);
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
    // A detached HEAD is not under any ref. Globs without matches (a new repository) push nothing.
    if (!repo.headUnborn()) walk.pushHead();
    for (const glob of WALK_GLOBS) walk.pushGlob(glob);
    return new HistoryCache(version, walk, stashesByBase);
  }
}
