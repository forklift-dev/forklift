// Typed contract for renderer → main commands. The channel name doubles as the command name.
import type { CheckoutTarget } from './branches';
import type { ConflictFile, ConflictSide, OperationAction } from './conflicts';
import type { CommitDetails, DiffTarget, FileDiff } from './diff';
import type { RebaseCommit, RebaseStep } from './rebase';
import type { CommitSignature, KeysInfo, ProfileApplied, SshKeyInfo } from './profiles';
import type { CloneRequest, CreateDefaults, InitRequest } from './repos';
import type { BlameResult, FileHistoryEntry } from './fileHistory';
import type { FoundCommit, HistoryFilter, HistoryPage, HistorySearch, SearchResult } from './history';
import type { DetectedTools, GitIdentity, GitToolKind, SettingsPatch, ToolKind } from './settings';
import type { LineActionRequest } from './staging';

/** Repository commands name their tab explicitly (`repo` = the tab id, i.e. the repository root). */
export interface Commands {
  /** Whole files: stage (also deletions), unstage, discard (tracked → index version, untracked → deleted). */
  'index:stage': { args: [repo: string, paths: string[]]; result: void };
  'index:unstage': { args: [repo: string, paths: string[]]; result: void };
  'index:discard': { args: [repo: string, paths: string[]]; result: void };
  /** Stage, unstage or discard picked lines of one file. */
  'index:applyLines': { args: [repo: string, request: LineActionRequest]; result: void };
  /** Commits the index (hooks run); returns the new commit hash. */
  'commit:create': { args: [repo: string, message: string, amend: boolean]; result: string };
  /** Rows `start…start+count` of the commit history with graph layout; `version` is RepoData.historyVersion. */
  'history:rows': { args: [repo: string, version: string, start: number, count: number, filter: HistoryFilter]; result: HistoryPage };
  /** Row index of a commit in the history (same version and filter), or -1. */
  'history:locate': { args: [repo: string, version: string, filter: HistoryFilter, sha: string]; result: number };
  /** Matching commits as row indices: message, author, sha prefix, file name or content (pickaxe). */
  'history:search': { args: [repo: string, version: string, filter: HistoryFilter, query: HistorySearch]; result: SearchResult };
  /** Commits for the finder (Ctrl+P): sha prefix or fuzzy subject. */
  'history:find': { args: [repo: string, version: string, filter: HistoryFilter, text: string]; result: FoundCommit[] };
  /** Files of the working tree (tracked and untracked, not ignored), for the finder. */
  'repo:files': { args: [repo: string]; result: { paths: string[]; truncated: boolean } };
  /** Metadata and changed files of a commit. */
  'commit:details': { args: [repo: string, sha: string]; result: CommitDetails };
  /** Both versions of one file for the built-in diff view. */
  'diff:file': { args: [repo: string, target: DiffTarget]; result: FileDiff };
  /** Why `name` cannot be a new branch/tag, or null when it can. */
  'ref:validateName': { args: [repo: string, kind: 'branch' | 'tag', name: string]; result: string | null };
  /** Creates a branch at a commit, optionally switching to it (uncommitted changes are carried along). */
  'branch:create': { args: [repo: string, name: string, sha: string, checkout: boolean]; result: void };
  /** Switches branch or commit; uncommitted changes are stashed and brought back (problems become a notice). */
  'branch:checkout': { args: [repo: string, target: CheckoutTarget]; result: void };
  'branch:rename': { args: [repo: string, from: string, to: string]; result: void };
  /** Without `force`, an unmerged branch is refused ("not fully merged"). */
  'branch:delete': { args: [repo: string, name: string, force: boolean]; result: void };
  /** `message` null: a lightweight tag; otherwise an annotated one. */
  'tag:create': { args: [repo: string, name: string, sha: string, message: string | null]; result: void };
  'tag:delete': { args: [repo: string, name: string]; result: void };
  /** Stashes uncommitted changes; resolves false when there was nothing to stash. */
  'stash:push': { args: [repo: string, options: { message: string; includeUntracked: boolean; stagedOnly: boolean }]; result: boolean };
  /** Applies a stash (by its sha) and keeps it; conflicts or failures become a notice. */
  'stash:apply': { args: [repo: string, sha: string]; result: void };
  /** Applies a stash and drops it if it applied cleanly (otherwise it is kept, with a notice). */
  'stash:pop': { args: [repo: string, sha: string]; result: void };
  'stash:drop': { args: [repo: string, sha: string]; result: void };
  /** Applies a commit onto the current branch; 'conflicts' when git stopped for them (see RepoData.operation). */
  'commit:cherryPick': { args: [repo: string, sha: string]; result: 'done' | 'conflicts' };
  /** Commits the inverse of a commit (merges: relative to the first parent). */
  'commit:revert': { args: [repo: string, sha: string]; result: 'done' | 'conflicts' };
  /** Moves the current branch to a commit: soft keeps changes staged, mixed unstaged, hard discards them. */
  'commit:reset': { args: [repo: string, sha: string, mode: 'soft' | 'mixed' | 'hard']; result: void };
  /** Merges a branch or commit into the current branch ('conflicts': git stopped, see RepoData.operation). */
  'branch:merge': { args: [repo: string, ref: string, mode: 'default' | 'no-ff' | 'ff-only' | 'squash', message: string | null]; result: 'done' | 'conflicts' };
  /** Rebases the current branch onto a branch or commit. */
  'branch:rebase': { args: [repo: string, onto: string]; result: 'done' | 'conflicts' };
  /** Fetches one remote or all (`remote` null), optionally pruning deleted remote branches. */
  'remote:fetch': { args: [repo: string, remote: string | null, prune: boolean]; result: void };
  /** Pulls into the current branch with merge or rebase ('conflicts': git stopped, see RepoData.operation). */
  'remote:pull': { args: [repo: string, rebase: boolean]; result: 'done' | 'conflicts' };
  /**
   * Pushes the current branch to its upstream, or to `remote` (becoming the upstream) when it has none.
   * A rejected push fails with a message starting "Rejected:"; `force` retries with --force-with-lease.
   */
  'remote:push': { args: [repo: string, remote: string | null, force: boolean]; result: void };
  'remote:add': { args: [repo: string, name: string, url: string]; result: void };
  'remote:rename': { args: [repo: string, from: string, to: string]; result: void };
  /** Fetch URL, or with `push` the separate push URL ('' removes it). */
  'remote:setUrl': { args: [repo: string, name: string, url: string, push: boolean]; result: void };
  /** Removes a remote and its remote-tracking branches. */
  'remote:remove': { args: [repo: string, name: string]; result: void };
  /** Undoes the last undoable action in the repository; resolves to its label. */
  'undo:undo': { args: [repo: string]; result: string };
  'undo:redo': { args: [repo: string]; result: string };
  /** Cancels the tab's running fetch/pull/push. */
  'remote:cancel': { args: [repo: string]; result: void };
  /** Answers a credential prompt (`null`: cancel). The answer is passed to git and kept nowhere. */
  'askpass:answer': { args: [id: number, answer: string | null]; result: void };
  /** Commits after `base` up to HEAD (oldest first) for the interactive rebase editor. */
  'rebase:plan': { args: [repo: string, base: string]; result: RebaseCommit[] };
  /** Runs an edited plan ('conflicts': git stopped, the operation banner continues it). */
  'rebase:interactive': { args: [repo: string, base: string, steps: RebaseStep[]]; result: 'done' | 'conflicts' };
  /** Versions of a conflicted file for the conflict editor. */
  'conflict:file': { args: [repo: string, path: string]; result: ConflictFile };
  /** Writes the edited result (refused if the file changed since `expectedHash`); optionally marks it resolved. */
  'conflict:save': { args: [repo: string, path: string, text: string, expectedHash: string | null, markResolved: boolean]; result: void };
  /** Resolves a file with one side's whole version (or its deletion). */
  'conflict:take': { args: [repo: string, path: string, side: ConflictSide]; result: void };
  /** Continues, aborts or skips the merge/rebase/cherry-pick/revert in progress. */
  'operation:run': { args: [repo: string, action: OperationAction]; result: void };
  /** Shows a folder picker; resolves to the chosen path or null when cancelled. */
  'repo:pick': { args: [purpose: 'open' | 'scan' | 'parent']; result: string | null };
  /** Starting values and template lists for the Clone and Init dialogs. */
  'repo:createDefaults': { args: []; result: CreateDefaults };
  /** Why a new repository can't go into `parent`/`name`, or null. */
  'repo:checkTarget': { args: [kind: 'clone' | 'init', parent: string, name: string]; result: string | null };
  /** Clones (progress in `app.clone`) and opens the result in a tab; resolves to its id. */
  'repo:clone': { args: [request: CloneRequest]; result: string };
  'repo:cancelClone': { args: []; result: void };
  /** Creates a repository with the chosen starter files and opens it in a tab. */
  'repo:init': { args: [request: InitRequest]; result: string };
  /** Opens the repository containing `path` in a tab (or switches to its tab); resolves to the tab id. */
  'repo:open': { args: [path: string]; result: string };
  'repo:activate': { args: [repo: string]; result: void };
  'repo:refresh': { args: [repo: string]; result: void };
  'repo:close': { args: [repo: string]; result: void };
  /** Moves a tab to `index` in the tab bar. */
  'repo:move': { args: [repo: string, index: number]; result: void };
  /** Opens the repository's root in the user's terminal. */
  'repo:openTerminal': { args: [repo: string]; result: void };
  /** Searches a folder for git repositories; a later scan or `repos:cancelScan` ends it early. */
  'repos:scan': { args: [folder: string]; result: string[] };
  'repos:cancelScan': { args: []; result: void };
  'repos:toggleFavorite': { args: [path: string]; result: void };
  /** Removes a repository from the recent list and favorites. */
  'repos:forget': { args: [path: string]; result: void };
  /** Opens a file of the repository (path relative to its root) in the external editor. */
  'file:openInEditor': { args: [repo: string, path: string, line?: number]; result: void };
  /** Commits that changed a file (following renames), newest first. */
  'file:history': { args: [repo: string, path: string]; result: FileHistoryEntry[] };
  /** Line authorship at a commit, or of the working tree file (`rev` null). */
  'file:blame': { args: [repo: string, path: string, rev: string | null]; result: BlameResult };
  /** Shows a file's changes in the external diff tool; resolves when its window closes. */
  'file:externalDiff': { args: [repo: string, path: string, staged: boolean]; result: void };
  /** Resolves a conflicted file in the external merge tool; resolves when its window closes. */
  'file:externalMerge': { args: [repo: string, path: string]; result: void };
  /** Starts a shell in the repository's folder in the embedded terminal; resolves to the terminal id. */
  'terminal:create': { args: [repo: string, cols: number, rows: number]; result: number };
  'terminal:resize': { args: [id: number, cols: number, rows: number]; result: void };
  'terminal:kill': { args: [id: number]; result: void };
  /** Changes settings (validated in main); `repo` targets that open repository's overrides. */
  /** Clears the notices shown above the window content. */
  'app:dismissNotices': { args: []; result: void };
  'settings:update': { args: [patch: SettingsPatch]; result: void };
  'settings:dismissProblems': { args: []; result: void };
  /** Shows a file picker for a program; resolves to its path or null when cancelled. */
  'settings:browseExecutable': { args: []; result: string | null };
  /** Writes a saved profile to git config: of the repository, or globally (`repo` null). */
  'profile:apply': { args: [profileId: string, repo: string | null]; result: void };
  /** The identity in effect for the repository (or globally) and which profile it matches. */
  'profile:current': { args: [repo: string | null]; result: ProfileApplied };
  /** SSH keys in ~/.ssh, the ssh-agent, and OpenPGP secret keys. */
  'keys:list': { args: []; result: KeysInfo };
  /** Creates an ed25519 key in ~/.ssh. */
  'keys:generateSsh': { args: [name: string, comment: string, passphrase: string]; result: SshKeyInfo };
  /** Loads a key into the ssh-agent (its passphrase is asked in the app). */
  'keys:addToAgent': { args: [path: string]; result: void };
  'keys:publicKey': { args: [path: string]; result: string };
  /** Whether a commit is signed and by whom (slow: runs gpg or ssh-keygen). */
  'commit:signature': { args: [repo: string, sha: string]; result: CommitSignature };
  /** Opens userData/themes in the file manager. */
  'themes:openFolder': { args: []; result: void };
  /** Editors, terminals and git diff/merge tools found on this machine (git config as seen from `repo`). */
  'tools:detect': { args: [repo: string | null]; result: DetectedTools };
  /** Runs the tool chosen for `repo` (or globally) on sample files; resolves with a description. */
  'tools:test': { args: [kind: ToolKind, repo: string | null]; result: string };
  /** Writes the diff/merge tool chosen in Preferences to global (`repo` null) or repository git config. */
  'tools:writeGitConfig': { args: [kind: GitToolKind, repo: string | null]; result: void };
  /** user.name/user.email from global (`repo` null) or repository git config (empty when unset). */
  'git:identity': { args: [repo: string | null]; result: GitIdentity };
  'git:setIdentity': { args: [repo: string | null, identity: GitIdentity]; result: void };
}


export type CommandName = keyof Commands;
export type CommandArgs<K extends CommandName> = Commands[K]['args'];
export type CommandResult<K extends CommandName> = Commands[K]['result'];

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } };

// A Record keyed by CommandName makes the compiler reject missing or unknown channels.
const commandChannelSet = {
  'index:stage': true,
  'index:unstage': true,
  'index:discard': true,
  'index:applyLines': true,
  'commit:create': true,
  'commit:details': true,
  'history:rows': true,
  'history:locate': true,
  'history:search': true,
  'history:find': true,
  'repo:files': true,
  'diff:file': true,
  'ref:validateName': true,
  'branch:create': true,
  'branch:checkout': true,
  'branch:rename': true,
  'branch:delete': true,
  'tag:create': true,
  'tag:delete': true,
  'stash:push': true,
  'stash:apply': true,
  'stash:pop': true,
  'stash:drop': true,
  'commit:cherryPick': true,
  'commit:revert': true,
  'commit:reset': true,
  'branch:merge': true,
  'branch:rebase': true,
  'remote:fetch': true,
  'remote:pull': true,
  'remote:push': true,
  'remote:cancel': true,
  'undo:undo': true,
  'undo:redo': true,
  'remote:add': true,
  'remote:rename': true,
  'remote:setUrl': true,
  'remote:remove': true,
  'askpass:answer': true,
  'rebase:plan': true,
  'rebase:interactive': true,
  'conflict:file': true,
  'conflict:save': true,
  'conflict:take': true,
  'operation:run': true,
  'repo:pick': true,
  'repo:createDefaults': true,
  'repo:checkTarget': true,
  'repo:clone': true,
  'repo:cancelClone': true,
  'repo:init': true,
  'repo:open': true,
  'repo:activate': true,
  'repo:refresh': true,
  'repo:close': true,
  'repo:move': true,
  'repo:openTerminal': true,
  'repos:scan': true,
  'repos:cancelScan': true,
  'repos:toggleFavorite': true,
  'repos:forget': true,
  'file:openInEditor': true,
  'file:externalDiff': true,
  'file:history': true,
  'file:blame': true,
  'file:externalMerge': true,
  'app:dismissNotices': true,
  'terminal:create': true,
  'terminal:resize': true,
  'terminal:kill': true,
  'settings:update': true,
  'settings:dismissProblems': true,
  'settings:browseExecutable': true,
  'themes:openFolder': true,
  'profile:apply': true,
  'profile:current': true,
  'keys:list': true,
  'keys:generateSsh': true,
  'keys:addToAgent': true,
  'keys:publicKey': true,
  'commit:signature': true,
  'tools:detect': true,
  'tools:test': true,
  'tools:writeGitConfig': true,
  'git:identity': true,
  'git:setIdentity': true,
} satisfies Record<CommandName, true>;

export const COMMAND_CHANNELS = Object.keys(commandChannelSet) as CommandName[];

export function isCommandName(value: unknown): value is CommandName {
  return typeof value === 'string' && Object.hasOwn(commandChannelSet, value);
}
