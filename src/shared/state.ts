// Application state owned by the main process and replicated to every renderer.

export interface Commit {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** Unix time in seconds. */
  authorTime: number;
  /** Decorations such as `HEAD -> main`, `origin/main`, `tag: v1.0`. */
  refs: string[];
  subject: string;
}

export type ChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted';

export interface FileChange {
  path: string;
  /** Source path of a rename or copy. */
  origPath?: string;
  kind: ChangeKind;
  staged: boolean;
  unstaged: boolean;
}

export interface BranchInfo {
  /** Branch name, or null when HEAD is detached. */
  head: string | null;
  /** Commit HEAD points at, or null in a repository without commits. */
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface RepoData {
  root: string;
  name: string;
  branch: BranchInfo;
  commits: Commit[];
  changes: FileChange[];
  loadedAt: number;
}

export interface RepoState {
  path: string | null;
  loading: boolean;
  error: string | null;
  data: RepoData | null;
  /** Thunk request currently allowed to write results; stale responses are dropped. */
  pendingRequestId: string | null;
}

export interface GitCliInfo {
  /** `git --version` of the git CLI in PATH, or null when not found. */
  version: string | null;
  minimumVersion: string;
  meetsMinimum: boolean;
}

export interface AppInfo {
  version: string;
  platform: string;
  /** Undefined until checked at startup. */
  gitCli?: GitCliInfo;
}

export interface AppState {
  app: AppInfo;
  repo: RepoState;
}

export type SliceName = keyof AppState;

// Replication protocol (main → renderer over a MessagePort).
// STATE carries a full snapshot, UPDATE carries only the top-level slices that changed.
export type ReplicaMessage =
  | { type: 'STATE'; updateIndex: number; state: AppState }
  | { type: 'UPDATE'; updateIndex: number; slices: Partial<AppState> };

/** Renderer → main acknowledgement that an update has been applied. */
export interface ReplicaAck {
  updateIndex: number;
}

export const REPLICA_READY_CHANNEL = 'replica:ready';
