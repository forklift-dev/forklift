import type { CommandArgs, CommandName, CommandResult } from '../../shared/ipc';

/** Calls a main-process command; resolves after this window's state replica is up to date. */
export async function invoke<K extends CommandName>(channel: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
  const result = await window.forklift.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
