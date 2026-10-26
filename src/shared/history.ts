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
  /** Their graph rows hold no Pass edges: lanes passing them are in `passes`. */
  rows: HistoryRow[];
  /** Lanes passing these rows as runs (PassRuns): `column, color, first row (from 0 = start), row count`, repeated. */
  passes: number[];
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

/** A commit the finder offers, with the subject characters that matched. */
export interface FoundCommit {
  sha: string;
  subject: string;
  authorName: string;
  authorTime: number;
  positions: number[];
}

export interface SearchResult {
  /** Row indices of matching commits in the history list (same version and filter), ascending. */
  indices: number[];
  /** More matches exist than were returned. */
  truncated: boolean;
}
