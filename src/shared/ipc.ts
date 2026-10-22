// Typed contract for renderer → main commands. The channel name doubles as the command name.
import type { CommitDetails, DiffTarget, FileDiff } from './diff';
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
  /** Metadata and changed files of a commit. */
  'commit:details': { args: [repo: string, sha: string]; result: CommitDetails };
  /** Both versions of one file for the built-in diff view. */
  'diff:file': { args: [repo: string, target: DiffTarget]; result: FileDiff };
  /** Shows a folder picker; resolves to the chosen path or null when cancelled. */
  'repo:pick': { args: [purpose: 'open' | 'scan']; result: string | null };
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
  /** Shows a file's changes in the external diff tool; resolves when its window closes. */
  'file:externalDiff': { args: [repo: string, path: string, staged: boolean]; result: void };
  /** Resolves a conflicted file in the external merge tool; resolves when its window closes. */
  'file:externalMerge': { args: [repo: string, path: string]; result: void };
  /** Changes settings (validated in main); `repo` targets that open repository's overrides. */
  /** Clears the notices shown above the window content. */
  'app:dismissNotices': { args: []; result: void };
  'settings:update': { args: [patch: SettingsPatch]; result: void };
  'settings:dismissProblems': { args: []; result: void };
  /** Shows a file picker for a program; resolves to its path or null when cancelled. */
  'settings:browseExecutable': { args: []; result: string | null };
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
  'diff:file': true,
  'repo:pick': true,
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
  'file:externalMerge': true,
  'app:dismissNotices': true,
  'settings:update': true,
  'settings:dismissProblems': true,
  'settings:browseExecutable': true,
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
