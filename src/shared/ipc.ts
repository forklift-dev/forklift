// Typed contract for renderer → main commands. The channel name doubles as the command name.
import type { CommitDetails, DiffTarget, FileDiff } from './diff';
import type { DetectedTools, GitIdentity, GitToolKind, SettingsPatch, ToolKind } from './settings';
import type { LineActionRequest } from './staging';

export interface Commands {
  /** Whole files: stage (also deletions), unstage, discard (tracked → index version, untracked → deleted). */
  'index:stage': { args: [paths: string[]]; result: void };
  'index:unstage': { args: [paths: string[]]; result: void };
  'index:discard': { args: [paths: string[]]; result: void };
  /** Stage, unstage or discard picked lines of one file. */
  'index:applyLines': { args: [request: LineActionRequest]; result: void };
  /** Commits the index (hooks run); returns the new commit hash. */
  'commit:create': { args: [message: string, amend: boolean]; result: string };
  /** Metadata and changed files of a commit in the open repository. */
  'commit:details': { args: [sha: string]; result: CommitDetails };
  /** Both versions of one file for the built-in diff view. */
  'diff:file': { args: [target: DiffTarget]; result: FileDiff };
  /** Shows a folder picker; resolves to the chosen path or null when cancelled. */
  'repo:pick': { args: []; result: string | null };
  'repo:open': { args: [path: string]; result: void };
  'repo:refresh': { args: []; result: void };
  'repo:close': { args: []; result: void };
  /** Opens the open repository's root in the user's terminal. */
  'repo:openTerminal': { args: []; result: void };
  /** Opens a file of the open repository (path relative to its root) in the external editor. */
  'file:openInEditor': { args: [path: string, line?: number]; result: void };
  /** Shows a file's changes in the external diff tool; resolves when its window closes. */
  'file:externalDiff': { args: [path: string, staged: boolean]; result: void };
  /** Resolves a conflicted file in the external merge tool; resolves when its window closes. */
  'file:externalMerge': { args: [path: string]; result: void };
  /** Changes settings (validated in main); `repo` targets that open repository's overrides. */
  'settings:update': { args: [patch: SettingsPatch]; result: void };
  'settings:dismissProblems': { args: []; result: void };
  /** Shows a file picker for a program; resolves to its path or null when cancelled. */
  'settings:browseExecutable': { args: []; result: string | null };
  /** Editors, terminals and git diff/merge tools found on this machine. */
  'tools:detect': { args: []; result: DetectedTools };
  /** Runs the chosen tool on sample files; resolves with a description once it is closed (diff/merge) or started. */
  'tools:test': { args: [kind: ToolKind, repo: boolean]; result: string };
  /** Writes the diff/merge tool chosen in Preferences to global or repository git config. */
  'tools:writeGitConfig': { args: [kind: GitToolKind, scope: ConfigScope]; result: void };
  /** user.name/user.email from global or repository git config (empty when unset). */
  'git:identity': { args: [scope: ConfigScope]; result: GitIdentity };
  'git:setIdentity': { args: [scope: ConfigScope, identity: GitIdentity]; result: void };
}

/** Which git config file an action reads or writes: the user's global one or the open repository's. */
export type ConfigScope = 'global' | 'repository';

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
  'repo:refresh': true,
  'repo:close': true,
  'repo:openTerminal': true,
  'file:openInEditor': true,
  'file:externalDiff': true,
  'file:externalMerge': true,
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
