import { ipcMain, type WebContents } from 'electron';
import { COMMAND_CHANNELS, type CommandArgs, type CommandName, type CommandResult, type IpcResult } from '../../shared/ipc';
import { isTrustedSender } from '../origin';

export interface CommandContext {
  sender: WebContents;
}

export type CommandHandlers = {
  [K in CommandName]: (ctx: CommandContext, ...args: CommandArgs<K>) => Promise<CommandResult<K>>;
};

interface RegistryDeps {
  waitForAck(webContentsId: number): Promise<void>;
}

/**
 * Registers one ipcMain.handle per command. Every reply is delayed until the caller's
 * state replica has caught up, so the renderer never sees a resolved call with stale state.
 */
export function registerCommands(handlers: CommandHandlers, { waitForAck }: RegistryDeps): void {
  for (const channel of COMMAND_CHANNELS) {
    const handler = handlers[channel] as (ctx: CommandContext, ...args: unknown[]) => Promise<unknown>;

    ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event.senderFrame)) {
        return { ok: false, error: { message: 'Untrusted sender' } };
      }
      let result: IpcResult<unknown>;
      try {
        result = { ok: true, value: await handler({ sender: event.sender }, ...args) };
      } catch (error) {
        console.error(`[ipc] ${channel} failed:`, error);
        result = { ok: false, error: { message: error instanceof Error ? error.message : String(error) } };
      }
      await waitForAck(event.sender.id);
      return result;
    });
  }
}
