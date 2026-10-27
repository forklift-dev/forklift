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
  /** Commit to diff for this file when it is not the shown commit itself (untracked files of a stash). */
  sourceSha?: string;
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

export type ComparisonMode = 'direct' | 'merge-base';

export interface ComparisonDetails {
  left: string;
  right: string;
  /** The actual left tree: left for A..B, common ancestor for A...B. */
  base: string;
  mode: ComparisonMode;
  files: CommitFile[];
  statsOmitted: boolean;
}

/** Which two versions of a file to compare. */
export type DiffTarget =
  | { kind: 'commit'; sha: string; path: string; oldPath?: string }
  | { kind: 'comparison'; base: string; head: string; path: string; oldPath?: string }
  /** staged: HEAD ↔ index; unstaged: index ↔ working tree. */
  | { kind: 'worktree'; path: string; oldPath?: string; staged: boolean };

export interface FileVersion {
  path: string;
  /** False when the file does not exist on this side (added or deleted). */
  exists: boolean;
  binary: boolean;
  /** Over the size limit; `text` is not loaded. */
  tooLarge: boolean;
  /** Text was capped to a safe display size; the diff covers the visible prefixes only. */
  truncated?: boolean;
  size: number;
  text: string | null;
  /** The bytes are not valid UTF-8, so `text` has replacement characters and must not be written back. */
  lossy: boolean;
  /** SHA-256 of `text`; lets main check that a view's line changes refer to the current content. */
  hash: string | null;
  /** Supported raster/SVG image payload, loaded by the main process. */
  image?: { dataUrl: string; mime: string };
  /** A binary file with an image extension that is not safe/possible to preview. */
  unsupportedImage?: boolean;
  /** Stored in Git LFS: `text` is the content when the object is in .git/lfs, else the pointer. */
  lfs?: { oid: string; size: number; downloaded: boolean };
}

export interface FileDiff {
  original: FileVersion;
  modified: FileVersion;
}

/** Larger versions are not sent to the window: the editor would freeze on them. */
/** Maximum text file size read for a diff. */
export const MAX_DIFF_FILE_BYTES = 50 * 1024 * 1024;
/** Maximum characters sent to Monaco from either version. */
export const MAX_DIFF_DISPLAY_CHARS = 2 * 1024 * 1024;
/** Image payloads travel through IPC as data URLs, so keep their limit lower. */
export const MAX_DIFF_IMAGE_BYTES = 10 * 1024 * 1024;
