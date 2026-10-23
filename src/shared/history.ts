import type { GraphRowLayout } from './graph';

/** A commit in the history list with its graph row. Branch and tag labels come from RepoData.refs. */
export interface HistoryRow {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** Unix time in seconds. */
  authorTime: number;
  subject: string;
  graph: GraphRowLayout;
  /** Set for a stash, drawn above the commit it was made on; `parents` then holds only that commit. */
  stash?: { index: number };
}

export interface HistoryPage {
  /** History version these rows belong to (RepoData.historyVersion at the time it was walked). */
  version: string;
  start: number;
  rows: HistoryRow[];
  /** Rows walked so far. */
  loaded: number;
  /** The whole history has been walked: `loaded` is the total. */
  complete: boolean;
}

/** Which branches the graph shows: `solo` non-empty shows only those refs; `hidden` leaves refs out. Full ref names. */
export interface HistoryFilter {
  solo: string[];
  hidden: string[];
}

export const NO_FILTER: HistoryFilter = { solo: [], hidden: [] };

export type SearchField = 'message' | 'author' | 'sha' | 'file' | 'content';

export interface HistorySearch {
  field: SearchField;
  text: string;
}

export interface SearchResult {
  /** Row indices of matching commits in the history list (same version and filter), ascending. */
  indices: number[];
  /** More matches exist than were returned. */
  truncated: boolean;
}
