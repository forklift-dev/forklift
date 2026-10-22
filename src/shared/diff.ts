// Diff data requested on demand by a window (not part of the replicated state: large, per-view).

export type FileChangeStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'typechange';

export interface CommitFile {
  path: string;
  /** Source path of a rename or copy. */
  oldPath?: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface Signature {
  name: string;
  email: string;
  /** Unix time in seconds. */
  time: number;
}

export interface CommitDetails {
  hash: string;
  parents: string[];
  author: Signature;
  committer: Signature;
  /** Full message: subject and body. */
  message: string;
  /** Changes against the first parent (an empty tree for a root commit). */
  files: CommitFile[];
  /** Line counts are skipped for very large commits to keep them fast to open. */
  statsOmitted: boolean;
}

/** Which two versions of a file to compare. */
export type DiffTarget =
  | { kind: 'commit'; sha: string; path: string; oldPath?: string }
  /** staged: HEAD ↔ index; unstaged: index ↔ working tree. */
  | { kind: 'worktree'; path: string; oldPath?: string; staged: boolean };

export interface FileVersion {
  path: string;
  /** False when the file does not exist on this side (added or deleted). */
  exists: boolean;
  binary: boolean;
  /** Over the size limit; `text` is not loaded. */
  tooLarge: boolean;
  size: number;
  text: string | null;
}

export interface FileDiff {
  original: FileVersion;
  modified: FileVersion;
}

/** Larger versions are not sent to the window: the editor would freeze on them. */
export const MAX_DIFF_FILE_BYTES = 10 * 1024 * 1024;
