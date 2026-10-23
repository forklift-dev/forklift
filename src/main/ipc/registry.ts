import { isAbsolute } from 'node:path';
import { ipcMain, type WebContents } from 'electron';
import { COMMAND_CHANNELS, type CommandArgs, type CommandName, type CommandResult, type IpcResult } from '../../shared/ipc';
import { isTrustedSender } from '../origin';
import { QUIET_COMMANDS, type OperationLog } from '../log/operationLog';

export interface CommandContext {
  sender: WebContents;
}

export type CommandHandlers = {
  [K in CommandName]: (ctx: CommandContext, ...args: CommandArgs<K>) => Promise<CommandResult<K>>;
};

interface RegistryDeps {
  waitForAck(webContentsId: number): Promise<void>;
  /** Logs commands that change something (with the git runs inside them). */
  log?: OperationLog;
}

/**
 * Registers one ipcMain.handle per command. Every reply is delayed until the caller's
 * state replica has caught up, so the renderer never sees a resolved call with stale state.
 */
export function registerCommands(handlers: CommandHandlers, { waitForAck, log }: RegistryDeps): void {
  for (const channel of COMMAND_CHANNELS) {
    const handler = handlers[channel] as (ctx: CommandContext, ...args: unknown[]) => Promise<unknown>;

    ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event.senderFrame)) {
        return { ok: false, error: { message: 'Untrusted sender' } };
      }
      let result: IpcResult<unknown>;
      let logId: number | undefined;
      try {
        const run = () => handler({ sender: event.sender }, ...args);
        const repo = typeof args[0] === 'string' && isAbsolute(args[0]) ? args[0] : null;
        const value = log && !QUIET_COMMANDS.has(channel) ? await log.operation(channel, repo, (id) => ((logId = id), run())) : await run();
        result = { ok: true, value };
      } catch (error) {
        console.error(`[ipc] ${channel} failed:`, error);
        result = { ok: false, error: { message: error instanceof Error ? error.message : String(error), ...(logId !== undefined && { logId }) } };
      }
      await waitForAck(event.sender.id);
      return result;
    });
  }
}
