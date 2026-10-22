// Typed contract for renderer → main commands. The channel name doubles as the command name.

export interface Commands {
  /** Shows a folder picker; resolves to the chosen path or null when cancelled. */
  'repo:pick': { args: []; result: string | null };
  'repo:open': { args: [path: string]; result: void };
  'repo:refresh': { args: []; result: void };
  'repo:close': { args: []; result: void };
}

export type CommandName = keyof Commands;
export type CommandArgs<K extends CommandName> = Commands[K]['args'];
export type CommandResult<K extends CommandName> = Commands[K]['result'];

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } };

// A Record keyed by CommandName makes the compiler reject missing or unknown channels.
const commandChannelSet = {
  'repo:pick': true,
  'repo:open': true,
  'repo:refresh': true,
  'repo:close': true,
} satisfies Record<CommandName, true>;

export const COMMAND_CHANNELS = Object.keys(commandChannelSet) as CommandName[];

export function isCommandName(value: unknown): value is CommandName {
  return typeof value === 'string' && Object.hasOwn(commandChannelSet, value);
}
