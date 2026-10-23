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
