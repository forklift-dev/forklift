// History and line authorship of one file.

export interface FileHistoryEntry {
  sha: string;
  authorName: string;
  authorEmail: string;
  /** Unix time in seconds. */
  time: number;
  subject: string;
  /** The file's path in this commit (it may have been renamed later). */
  path: string;
  /** Path before a rename in this commit. */
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange';
}

export interface BlameCommit {
  authorName: string;
  authorEmail: string;
  time: number;
  summary: string;
}

export interface BlameResult {
  /** The file's text as blamed (a revision, or the working tree). */
  text: string;
  /** Consecutive lines from one commit: 1-based start line and count. */
  hunks: Array<{ sha: string; start: number; count: number }>;
  /** Commit details by sha; uncommitted lines have the all-zero sha. */
  commits: Record<string, BlameCommit>;
}

export const UNCOMMITTED = '0000000000000000000000000000000000000000';
