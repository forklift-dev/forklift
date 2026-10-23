import type { CommandArgs, CommandName, CommandResult } from '../../shared/ipc';

/** The operation log entry behind a failed command, if it was logged. */
export const logIdOf = (error: unknown): number | null => (error instanceof Error && typeof (error as { logId?: unknown }).logId === 'number' ? (error as unknown as { logId: number }).logId : null);

/** Calls a main-process command; resolves after this window's state replica is up to date. */
export async function invoke<K extends CommandName>(channel: K, ...args: CommandArgs<K>): Promise<CommandResult<K>> {
  const result = await window.forklift.invoke(channel, ...args);
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error.logId !== undefined && { logId: result.error.logId });
  return result.value;
}
