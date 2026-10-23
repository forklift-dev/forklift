// Application state owned by the main process and replicated to every renderer.
import type { SettingsState } from './settings';

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

export interface LocalBranch {
  name: string;
  /** Commit the branch points at. */
  sha: string;
  /** Tracked remote branch, e.g. `origin/main`. */
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Checked out (HEAD points at it). */
  current: boolean;
}

export interface RemoteBranch {
  /** As git shows it: `origin/main`. */
  name: string;
  remote: string;
  sha: string;
}

export interface TagInfo {
  name: string;
  /** The commit it labels (annotated tags peeled). */
  sha: string;
  annotated: boolean;
}

export interface StashInfo {
  /** Position: stash@{index}. Changes as stashes come and go; operations use `sha`. */
  index: number;
  sha: string;
  /** Commit the changes were stashed on. */
  base: string;
  /** "On main: message" or "WIP on main: <commit>". */
  message: string;
  /** Unix time in seconds. */
  time: number;
}

export interface RepoData {
  root: string;
  name: string;
  branch: BranchInfo;
  branches: LocalBranch[];
  remoteBranches: RemoteBranch[];
  tags: TagInfo[];
  remotes: string[];
  /** Newest first. */
  stashes: StashInfo[];
  /** `git log --decorate` labels by commit sha: `HEAD -> main`, `origin/main`, `tag: v1.0`. */
  refs: Record<string, string[]>;
  /**
   * Changes whenever the history list may change (a commit, a ref moved). The history itself is not
   * replicated; windows fetch it page by page with `history:rows` and reload on a new version.
   */
  historyVersion: string;
  changes: FileChange[];
  loadedAt: number;
}

/** One open repository (a tab). */
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
  /** Problems outside any window action (e.g. a repository named on the command line could not be opened). */
  notices: string[];
}

/** A tab in the tab bar; `id` is the repository root (or the remembered path when it is gone). */
export interface TabInfo {
  id: string;
  name: string;
  loading: boolean;
  /** Why the repository could not be read (e.g. it was moved or deleted). */
  error: string | null;
}

export interface TabsState {
  tabs: TabInfo[];
  activeId: string | null;
}

export interface RecentRepo {
  path: string;
  name: string;
  /** Unix time in milliseconds. */
  openedAt: number;
}

/** Recently opened and favorite repositories, for the Repositories screen. */
export interface LibraryState {
  recent: RecentRepo[];
  favorites: string[];
}

/**
 * What a window sees. Main keeps every open repository; the window gets the tab list and the full
 * data of the active tab only, so switching tabs never copies other repositories' histories.
 */
export interface AppState {
  app: AppInfo;
  settings: SettingsState;
  tabs: TabsState;
  /** The active tab's repository (an empty state without tabs). */
  repo: RepoState;
  library: LibraryState;
}

export const EMPTY_REPO_STATE: RepoState = { path: null, loading: false, error: null, data: null, pendingRequestId: null };

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
