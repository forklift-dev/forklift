import type { HistoryFilter, HistoryRow } from '../../shared/history';
import { invoke } from './api';

export const PAGE_SIZE = 200;
/** Pages kept; beyond that the ones farthest from where the list is looked at are dropped (and fetched again). */
const MAX_PAGES = 64;

/**
 * Pages of one repository's history at one version, fetched from main as they come into view.
 * While its own pages load, rows of the previous version are shown, so a new commit does not blank the list.
 */
export class HistoryPages {
  private readonly pages = new Map<number, HistoryRow[]>();
  private readonly pending = new Set<number>();
  private readonly listeners = new Set<() => void>();
  private fallback: HistoryPages | null;
  private snapshot = 0;
  /** The page the list last asked around. */
  private focus = 0;
  private readonly created = performance.now();
  /** How long the first page took (null until it came): a slow one suggests git's commit-graph. */
  firstPageMs: number | null = null;
  loaded = 0;
  complete = false;
  /** Widest graph row seen, in lanes; the graph column does not jump while scrolling. */
  maxWidth = 1;
  error: string | null = null;

  constructor(
    readonly repo: string,
    readonly version: string,
    readonly filter: HistoryFilter,
    previous: HistoryPages | null = null,
  ) {
    // Skip a previous store that never got its own rows: no chain of stale stores builds up.
    this.fallback = previous && !previous.pages.has(0) ? previous.fallback : previous;
    if (previous) {
      this.loaded = previous.loaded;
      this.maxWidth = previous.maxWidth;
    }
  }

  /** Rows the list has room for: everything walked, plus a page more while history continues. */
  get rowCount(): number {
    return this.complete ? this.loaded : this.loaded + PAGE_SIZE;
  }

  row(index: number): HistoryRow | undefined {
    const page = this.pages.get(Math.floor(index / PAGE_SIZE));
    if (page) return page[index % PAGE_SIZE];
    return this.fallback?.row(index);
  }

  /** Index of a commit among loaded rows, or -1. */
  indexOf(hash: string): number {
    for (const [page, rows] of this.pages) {
      const index = rows.findIndex((row) => row.hash === hash);
      if (index >= 0) return page * PAGE_SIZE + index;
    }
    return -1;
  }

  /** Makes sure the pages covering rows `first…last` are loaded or on their way. */
  request(first: number, last: number): void {
    this.focus = Math.floor((Math.max(0, first) + Math.max(0, last)) / 2 / PAGE_SIZE);
    for (let page = Math.floor(Math.max(0, first) / PAGE_SIZE); page <= Math.floor(last / PAGE_SIZE); page++) {
      if (this.pages.has(page) || this.pending.has(page)) continue;
      if (this.complete && page * PAGE_SIZE >= this.loaded) continue;
      this.pending.add(page);
      invoke('history:rows', this.repo, this.version, page * PAGE_SIZE, PAGE_SIZE, this.filter).then(
        (result) => {
          this.pending.delete(page);
          this.pages.set(page, result.rows);
          this.evict();
          this.loaded = Math.max(result.loaded, page * PAGE_SIZE + result.rows.length);
          this.complete = result.complete;
          for (const row of result.rows) this.maxWidth = Math.max(this.maxWidth, row.graph.width);
          // The first own page replaces the previous version's rows everywhere.
          if (page === 0) {
            this.fallback = null;
            this.firstPageMs ??= performance.now() - this.created;
          }
          this.emit();
        },
        (error: unknown) => {
          this.pending.delete(page);
          this.error = error instanceof Error ? error.message : String(error);
          this.emit();
        },
      );
    }
  }

  /** A long scroll through a huge history keeps only the pages around the current position. */
  private evict(): void {
    while (this.pages.size > MAX_PAGES) {
      let farthest = -1;
      for (const page of this.pages.keys()) if (farthest < 0 || Math.abs(page - this.focus) > Math.abs(farthest - this.focus)) farthest = page;
      this.pages.delete(farthest);
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Changes on every arrival; for useSyncExternalStore. */
  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot += 1;
    for (const listener of this.listeners) listener();
  }
}

const latest = new Map<string, HistoryPages>();

/**
 * The page store for a repository's current history version. A new version starts a new store that
 * shows the previous one's rows until its own arrive. Idempotent, so it is safe to call while rendering.
 */
export function historyPages(repo: string, version: string, filter: HistoryFilter): HistoryPages {
  const previous = latest.get(repo);
  if (previous?.version === version && filterKey(previous.filter) === filterKey(filter)) return previous;
  // A new filter shows a different list: no rows of the old one meanwhile.
  const sameList = previous && filterKey(previous.filter) === filterKey(filter);
  const next = new HistoryPages(repo, version, filter, sameList ? previous : null);
  latest.set(repo, next);
  return next;
}

export const filterKey = (filter: HistoryFilter) => JSON.stringify([[...filter.solo].sort(), [...filter.hidden].sort()]);
