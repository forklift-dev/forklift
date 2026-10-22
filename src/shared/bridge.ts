import type { CommandArgs, CommandName, CommandResult, IpcResult } from './ipc';
import type { ReplicaMessage } from './state';

/** API the preload script exposes to the renderer as `window.forklift`. */
export interface ForkliftBridge {
  platform: string;
  invoke<K extends CommandName>(channel: K, ...args: CommandArgs<K>): Promise<IpcResult<CommandResult<K>>>;
  /** Messages received before the first listener attaches are buffered and replayed to it. */
  onReplicaMessage(listener: (message: ReplicaMessage) => void): () => void;
  ackReplicaUpdate(updateIndex: number): void;
}
