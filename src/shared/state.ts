// Application state owned by the main process and replicated to every renderer.
import type { CloneActivity } from './repos';
import type { UserThemesState } from './themes';
import type { HookActivity } from './hooks';
import type { BisectActivity } from './bisect';
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
  /** A submodule: its checked-out commit or contents changed (staged and discarded as a whole). */
  submodule?: true;
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

/** A multi-step git operation in progress (it stopped for conflicts or for the user). */
export interface RepoOperation {
  kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert';
  /** Rebase progress: the commit being applied, of how many. */
  step?: number;
  total?: number;
  /** What is being merged/picked/applied, as git names it (branch or short sha). */
  subject?: string;
}

export interface RepoData {
  root: string;
  name: string;
  branch: BranchInfo;
  branches: LocalBranch[];
  remoteBranches: RemoteBranch[];
  tags: TagInfo[];
  remotes: string[];
  /** Fetch and push URLs by remote name (`push` only when it differs). */
  remoteUrls: Record<string, { fetch: string; push?: string }>;
  /** Newest first. */
  stashes: StashInfo[];
  operation: RepoOperation | null;
  /** Whether a plain pull rebases (branch.<name>.rebase, else pull.rebase); the UI offers both either way. */
  pullRebase: boolean;
  /** A commit message git prepared (MERGE_MSG of a merge or cherry-pick, SQUASH_MSG of a squash), to prefill the form. */
  preparedMessage: string | null;
  /** `git log --decorate` labels by commit sha: `HEAD -> main`, `origin/main`, `tag: v1.0`. */
  refs: Record<string, string[]>;
  /**
   * Changes whenever the history list may change (a commit, a ref moved). The history itself is not
   * replicated; windows fetch it page by page with `history:rows` and reload on a new version.
   */
  historyVersion: string;
  /** git's commit-graph file exists: large histories open several times faster with it. */
  commitGraph: boolean;
  changes: FileChange[];
  loadedAt: number;
}

/** A fetch, pull or push running for a tab, with git's progress. */
export interface RemoteActivity {
  kind: 'fetch' | 'pull' | 'push' | 'submodules';
  phase: string | null;
  percent: number | null;
}

/** One open repository (a tab). */
export interface RepoState {
  bisect?: BisectActivity | null;
  /** Network operation in progress (it can be cancelled). */
  remote?: RemoteActivity | null;
  /** Hooks running in a commit or push. */
  hooks?: HookActivity | null;
  /** Labels of what Undo and Redo would do ("commit “Fix x”"), null when nothing. */
  undo?: { undo: string | null; redo: string | null };
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

export type AskPromptKind = 'username' | 'password' | 'passphrase' | 'confirm' | 'other';

/** A question from git or ssh waiting for the user (the answer never enters the state). */
export interface AskPrompt {
  id: number;
  kind: AskPromptKind;
  /** As git or ssh wrote it, e.g. "Password for 'https://ada@example.com': ". */
  prompt: string;
  /** Repository (tab id) the operation runs in. */
  repo: string | null;
}

export interface AppInfo {
  version: string;
  platform: string;
  /** Undefined until checked at startup. */
  gitCli?: GitCliInfo;
  /** Problems outside any window action (e.g. a repository named on the command line could not be opened). */
  notices: string[];
  prompts: AskPrompt[];
  /** The clone running from the Repositories screen. */
  clone: CloneActivity | null;
  /** Themes from userData/themes. */
  userThemes: UserThemesState;
  /** Changes whenever the operation log does (windows then read the new entries). */
  logVersion: number;
  /** Passwords can be remembered (the system keychain is available to the app). */
  secretStorage: boolean;
  /** A group's fetch or pull, while it runs and after (until the next one or dismissed). */
  groupSync: GroupSync | null;
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
  groups: RepoGroup[];
}

/** A named set of repositories (local only), opened and fetched or pulled together. */
export interface RepoGroup {
  id: string;
  name: string;
  /** Index into the theme's lane colors. */
  color: number;
  repos: string[];
}

export const MAX_GROUPS = 50;
export const MAX_GROUP_REPOS = 200;

/** A group's fetch or pull running from the Repositories screen, with a line per repository. */
export interface GroupSync {
  groupId: string;
  mode: 'fetch' | 'pull';
  done: boolean;
  repos: Array<{ path: string; name: string; status: 'waiting' | 'running' | 'ok' | 'up-to-date' | 'skipped' | 'failed'; message: string }>;
}

export interface RepoGroupStatus {
  path: string;
  name: string;
  branch: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  error: string | null;
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

/** A command the app is running, as the status bar lists it. */
export interface RunningCommand {
  id: number;
  /** The command line, credentials masked. */
  title: string;
  /** Unix time in milliseconds. */
  startedAt: number;
}

/** What the status bar shows besides the replicated state; read every few seconds while it is visible. */
export interface AppStatus {
  /** Memory of all the app's processes, in bytes. */
  memory: number;
  running: RunningCommand[];
  /** When the repository last fetched (git wrote FETCH_HEAD), Unix ms; null if it never did. */
  lastFetch: number | null;
  /** Commits reachable from HEAD, branches, remotes and tags; null until it can be read. */
  historySize: number | null;
}
