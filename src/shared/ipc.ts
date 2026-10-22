// Typed contract for renderer → main commands. The channel name doubles as the command name.
import type { CommitDetails, DiffTarget, FileDiff } from './diff';

export interface Commands {
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
}

export type CommandName = keyof Commands;
export type CommandArgs<K extends CommandName> = Commands[K]['args'];
export type CommandResult<K extends CommandName> = Commands[K]['result'];

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } };

// A Record keyed by CommandName makes the compiler reject missing or unknown channels.
const commandChannelSet = {
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
} satisfies Record<CommandName, true>;

export const COMMAND_CHANNELS = Object.keys(commandChannelSet) as CommandName[];

export function isCommandName(value: unknown): value is CommandName {
  return typeof value === 'string' && Object.hasOwn(commandChannelSet, value);
}
