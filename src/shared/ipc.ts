// Typed contract for renderer → main commands. The channel name doubles as the command name.
import type { CheckoutTarget } from './branches';
import type { BisectMark, BisectStatus } from './bisect';
import type { ConflictFile, ConflictSide, OperationAction } from './conflicts';
import type { CommitDetails, ComparisonDetails, ComparisonMode, DiffTarget, FileDiff } from './diff';
import type { RebaseCommit, RebaseStep } from './rebase';
import type { FlowFinishOptions, FlowKind, GitflowConfig } from './gitflow';
import type { HooksInfo } from './hooks';
import type { LfsInfo } from './lfs';
import type { SavedCredential } from './credentials';
import type { HostingAccount, HostingComment, HostingProvider, HostingRepo, IssueDetails, IssueSummary, PullDetails, PullSummary, RepoHosting } from './hosting';
import type { LogEntry, LogPage } from './log';
import type { CommitSignature, KeysInfo, ProfileApplied, SshKeyInfo } from './profiles';
import type { CloneRequest, CreateDefaults, InitRequest } from './repos';
import type { SubmoduleInfo } from './submodules';
import type { WorktreeAddRequest, WorktreeInfo } from './worktrees';
import type { TaskWorkspace, TaskWorkspaceCreate } from './taskWorkspaces';
import type { BlameResult, FileHistoryEntry } from './fileHistory';
import type { FoundCommit, HistoryFilter, HistoryPage, HistorySearch, SearchResult } from './history';
import type { DetectedTools, GitIdentity, GitToolKind, SettingsPatch, ToolKind } from './settings';
import type { LineActionRequest } from './staging';
import type { AppStatus, RepoGroup, RepoGroupStatus } from './state';
import type { ReleaseCheck } from './releases';

/** Repository commands name their tab explicitly (`repo` = the tab id, i.e. the repository root). */
export interface Commands {
  /** Whole files: stage (also deletions), unstage, discard (tracked → index version, untracked → deleted). */
  'index:stage': { args: [repo: string, paths: string[]]; result: void };
  'index:unstage': { args: [repo: string, paths: string[]]; result: void };
  'index:discard': { args: [repo: string, paths: string[]]; result: void };
  /** Stage, unstage or discard picked lines of one file. */
  'index:applyLines': { args: [repo: string, request: LineActionRequest]; result: void };
  /** Commits the index (hooks run); returns the new commit hash. */
  /** `skipHooks`: `--no-verify` (pre-commit and commit-msg hooks do not run). */
  'commit:create': { args: [repo: string, message: string, amend: boolean, options?: { skipHooks?: boolean }]; result: string };
  'ai:assist': { args: [repo: string, task: 'message' | 'review' | 'conflict' | 'commit', requestId: string, provider: string, target?: string]; result: string };
  'ai:cancel': { args: [requestId: string]; result: void };
  'ai:keyStatus': { args: []; result: { available: boolean; saved: boolean } };
  'ai:keySet': { args: [key: string]; result: void };
  'ai:keyRemove': { args: []; result: void };
  /** Hooks git would run in this repository (honouring core.hooksPath). */
  'hooks:list': { args: [repo: string]; result: HooksInfo };
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
  'repo:health': { args: [repo: string]; result: { healthy: boolean; integrity: string[]; objectStore: { loose: number; packed: number; size: string; packs: number }; largeFiles: { path: string; size: number }[]; scannedObjects: number; truncated: boolean } };
  /** Metadata and changed files of a commit. */
  'commit:details': { args: [repo: string, sha: string]; result: CommitDetails };
  'commit:rangePreview': { args: [repo: string, from: string, to: string]; result: { commits: { sha: string; subject: string }[]; tooLarge: boolean } };
  'commit:rangeApply': { args: [repo: string, from: string, to: string, action: 'cherry-pick' | 'revert']; result: { result: 'done' | 'conflicts'; applied: number; total: number } };
  'comparison:details': { args: [repo: string, left: string, right: string, mode: ComparisonMode]; result: ComparisonDetails };
  /** Both versions of one file for the built-in diff view. */
  'diff:file': { args: [repo: string, target: DiffTarget]; result: FileDiff };
  /** Why `name` cannot be a new branch/tag, or null when it can. */
  'ref:validateName': { args: [repo: string, kind: 'branch' | 'tag', name: string]; result: string | null };
  /** Creates a branch at a commit, optionally switching to it (uncommitted changes are carried along). */
  'branch:create': { args: [repo: string, name: string, sha: string, checkout: boolean]; result: void };
  /** Local branches fully merged into HEAD, for safe cleanup suggestions. */
  'branch:mergedLocal': { args: [repo: string]; result: string[] };
  /** Switches branch or commit; uncommitted changes are stashed and brought back (problems become a notice). */
  'branch:checkout': { args: [repo: string, target: CheckoutTarget]; result: void };
  'branch:rename': { args: [repo: string, from: string, to: string]; result: void };
  /** The remote-tracking branch (`origin/main`) a local branch follows; null stops following one. */
  'branch:setUpstream': { args: [repo: string, branch: string, upstream: string | null]; result: void };
  /** Without `force`, an unmerged branch is refused ("not fully merged"). */
  'branch:delete': { args: [repo: string, name: string, force: boolean]; result: void };
  /** `message` null: a lightweight tag; otherwise an annotated one. */
  'tag:create': { args: [repo: string, name: string, sha: string, message: string | null]; result: void };
  'tag:delete': { args: [repo: string, name: string]; result: void };
  'tag:push': { args: [repo: string, name: string, remote: string]; result: void };
  'tag:deleteRemote': { args: [repo: string, name: string, remote: string]; result: void };
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
  'bisect:status': { args: [repo: string]; result: BisectStatus | null };
  'bisect:mark': { args: [repo: string, mark: BisectMark, sha: string]; result: void };
  'bisect:run': { args: [repo: string, executable: string, args: string[]]; result: void };
  'bisect:cancel': { args: [repo: string]; result: void };
  'bisect:reset': { args: [repo: string]; result: void };
  'bisect:clearOutput': { args: [repo: string]; result: void };
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
  /** `remember`: keep the username and password git confirms (in the app's keychain-encrypted store). */
  'askpass:answer': { args: [id: number, answer: string | null, remember?: boolean]; result: void };
  /** Saved HTTPS usernames and passwords (without the passwords). */
  'credentials:list': { args: []; result: SavedCredential[] };
  'credentials:remove': { args: [id: string]; result: void };
  /** Checks the token with the server and adds the account (its token goes to the keychain, not the settings). */
  'hosting:add': { args: [provider: HostingProvider, url: string, token: string]; result: HostingAccount };
  'hosting:remove': { args: [accountId: string]; result: void };
  /** Repositories the account can access, for the Clone dialog. */
  'hosting:repos': { args: [accountId: string]; result: HostingRepo[] };
  /** The server and repository behind the tab's remotes, or null when no account matches. */
  'hosting:context': { args: [repo: string]; result: RepoHosting | null };
  'hosting:pulls': { args: [repo: string, state: 'open' | 'closed' | 'all']; result: PullSummary[] };
  'hosting:pull': { args: [repo: string, number: number]; result: PullDetails };
  /** Opens a pull request from a branch already pushed to the server. */
  'hosting:createPull': { args: [repo: string, pull: { head: string; base: string; title: string; body: string }]; result: PullSummary };
  /** Fetches the pull request's branch and switches to it (a fork's: as local branch pr/<number>). */
  'hosting:checkoutPull': { args: [repo: string, number: number]; result: void };
  'hosting:issues': { args: [repo: string, state: 'open' | 'closed' | 'all']; result: IssueSummary[] };
  'hosting:issue': { args: [repo: string, number: number]; result: IssueDetails };
  'hosting:createIssue': { args: [repo: string, issue: { title: string; body: string }]; result: IssueSummary };
  /** Comments on a pull request or an issue (Forgejo and GitHub number them together, GitLab separately). */
  'hosting:comment': { args: [repo: string, kind: 'pull' | 'issue', number: number, body: string]; result: HostingComment };
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
  /** `git commit-graph write --reachable` (as git maintenance does): large histories open several times faster. */
  'repo:writeCommitGraph': { args: [repo: string]; result: void };
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
  'repos:groupCreate': { args: [name: string]; result: RepoGroup };
  'repos:groupUpdate': { args: [id: string, patch: Partial<Pick<RepoGroup, 'name' | 'color' | 'repos'>>]; result: void };
  'repos:groupRemove': { args: [id: string]; result: void };
  'repos:groupSync': { args: [id: string, mode: 'fetch' | 'pull']; result: void };
  'repos:groupCancel': { args: []; result: void };
  'repos:groupDismiss': { args: []; result: void };
  'repos:groupStatus': { args: [id: string]; result: RepoGroupStatus[] };
  /** Opens a file of the repository (path relative to its root) in the external editor. */
  'file:openInEditor': { args: [repo: string, path: string, line?: number]; result: void };
  /** Commits that changed a file (following renames), newest first. */
  'file:history': { args: [repo: string, path: string, range?: { base: string; head: string }]; result: FileHistoryEntry[] };
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
  /** Checks public GitHub Releases now, even if startup checks are disabled. */
  'app:checkRelease': { args: []; result: ReleaseCheck };
  /** Memory, running commands and the repository's last fetch, for the status bar. */
  'app:status': { args: [repo: string | null]; result: AppStatus };
  /** Stops a running command (from the status bar). */
  'process:cancel': { args: [id: number]; result: void };
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
  /** Operation log entries after `afterId`, oldest first. */
  'log:entries': { args: [afterId: number]; result: LogPage };
  /** One operation with the git runs inside it. */
  'log:operation': { args: [id: number]; result: LogEntry[] };
  'log:clear': { args: []; result: void };
  /** Saves the log as text where the user chooses; resolves to the file, or null when cancelled. */
  'log:export': { args: []; result: string | null };
  'submodule:list': { args: [repo: string]; result: SubmoduleInfo[] };
  /** Clones `url` into `path` as a submodule (recorded in the index, to be committed). */
  'submodule:add': { args: [repo: string, url: string, path: string]; result: void };
  /** `submodule update --init --recursive` for `paths`, or all of them (null). */
  'submodule:update': { args: [repo: string, paths: string[] | null]; result: void };
  'submodule:sync': { args: [repo: string]; result: void };
  /** Removes a submodule (staged, to be committed) and its clone in .git/modules. */
  'submodule:remove': { args: [repo: string, path: string]; result: void };
  /** Gitflow settings from git config, or null when not set up. */
  'gitflow:config': { args: [repo: string]; result: GitflowConfig | null };
  'gitflow:init': { args: [repo: string, config: GitflowConfig]; result: void };
  /** Creates and checks out the flow branch; resolves to its name. */
  'gitflow:start': { args: [repo: string, kind: FlowKind, name: string]; result: string };
  'gitflow:finish': { args: [repo: string, branch: string, options: FlowFinishOptions]; result: void };
  /** git-lfs version, LFS patterns, and which of `paths` are in LFS. */
  'lfs:info': { args: [repo: string, paths: string[]]; result: LfsInfo };
  'lfs:track': { args: [repo: string, pattern: string]; result: void };
  'lfs:untrack': { args: [repo: string, pattern: string]; result: void };
  /** `git lfs pull` (`checkout`) or `git lfs fetch`. */
  'lfs:download': { args: [repo: string, checkout: boolean]; result: void };
  'worktree:list': { args: [repo: string]; result: WorktreeInfo[] };
  /** Creates a working tree and opens it in a tab; resolves to its tab id. */
  'worktree:add': { args: [repo: string, request: WorktreeAddRequest]; result: string };
  /** `force`: also with uncommitted changes in it (they are lost). */
  'worktree:remove': { args: [repo: string, path: string, force: boolean]; result: void };
  'worktree:lock': { args: [repo: string, path: string, locked: boolean]; result: void };
  'worktree:prune': { args: [repo: string]; result: void };
  'taskWorkspace:list': { args: [repo: string]; result: TaskWorkspace[] };
  'taskWorkspace:create': { args: [repo: string, input: TaskWorkspaceCreate]; result: TaskWorkspace };
  'taskWorkspace:updateNote': { args: [repo: string, id: string, note: string]; result: void };
  /** Gravatar pictures (data: URLs) by email; empty unless the setting is on. */
  'avatars:get': { args: [emails: string[]]; result: Record<string, string> };
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
  /** `logId`: the operation log entry with the details (the git commands and their output). */
  | { ok: false; error: { message: string; logId?: number } };

// A Record keyed by CommandName makes the compiler reject missing or unknown channels.
const commandChannelSet = {
  'index:stage': true,
  'index:unstage': true,
  'index:discard': true,
  'index:applyLines': true,
  'commit:create': true,
  'ai:assist': true,
  'ai:cancel': true,
  'ai:keyStatus': true,
  'ai:keySet': true,
  'ai:keyRemove': true,
  'hooks:list': true,
  'commit:details': true,
  'comparison:details': true,
  'history:rows': true,
  'history:locate': true,
  'history:search': true,
  'history:find': true,
  'repo:files': true,
  'repo:health': true,
  'diff:file': true,
  'ref:validateName': true,
  'branch:create': true,
  'branch:mergedLocal': true,
  'branch:checkout': true,
  'branch:rename': true,
  'branch:setUpstream': true,
  'branch:delete': true,
  'tag:create': true,
  'tag:delete': true,
  'tag:push': true,
  'tag:deleteRemote': true,
  'stash:push': true,
  'stash:apply': true,
  'stash:pop': true,
  'stash:drop': true,
  'commit:cherryPick': true,
  'commit:rangePreview': true,
  'commit:rangeApply': true,
  'commit:revert': true,
  'commit:reset': true,
  'bisect:status': true,
  'bisect:mark': true,
  'bisect:run': true,
  'bisect:cancel': true,
  'bisect:reset': true,
  'bisect:clearOutput': true,
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
  'credentials:list': true,
  'credentials:remove': true,
  'hosting:add': true,
  'hosting:remove': true,
  'hosting:repos': true,
  'hosting:context': true,
  'hosting:pulls': true,
  'hosting:pull': true,
  'hosting:createPull': true,
  'hosting:checkoutPull': true,
  'hosting:issues': true,
  'hosting:issue': true,
  'hosting:createIssue': true,
  'hosting:comment': true,
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
  'repo:writeCommitGraph': true,
  'repo:close': true,
  'repo:move': true,
  'repo:openTerminal': true,
  'repos:scan': true,
  'repos:cancelScan': true,
  'repos:toggleFavorite': true,
  'repos:forget': true,
  'repos:groupCreate': true,
  'repos:groupUpdate': true,
  'repos:groupRemove': true,
  'repos:groupSync': true,
  'repos:groupCancel': true,
  'repos:groupDismiss': true,
  'repos:groupStatus': true,
  'file:openInEditor': true,
  'file:externalDiff': true,
  'file:history': true,
  'file:blame': true,
  'file:externalMerge': true,
  'app:dismissNotices': true,
  'app:checkRelease': true,
  'app:status': true,
  'process:cancel': true,
  'terminal:create': true,
  'terminal:resize': true,
  'terminal:kill': true,
  'settings:update': true,
  'settings:dismissProblems': true,
  'settings:browseExecutable': true,
  'themes:openFolder': true,
  'avatars:get': true,
  'gitflow:config': true,
  'gitflow:init': true,
  'gitflow:start': true,
  'gitflow:finish': true,
  'lfs:info': true,
  'lfs:track': true,
  'lfs:untrack': true,
  'lfs:download': true,
  'worktree:list': true,
  'worktree:add': true,
  'worktree:remove': true,
  'worktree:lock': true,
  'worktree:prune': true,
  'taskWorkspace:list': true,
  'taskWorkspace:create': true,
  'taskWorkspace:updateNote': true,
  'submodule:list': true,
  'submodule:add': true,
  'submodule:update': true,
  'submodule:sync': true,
  'submodule:remove': true,
  'log:entries': true,
  'log:operation': true,
  'log:clear': true,
  'log:export': true,
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
