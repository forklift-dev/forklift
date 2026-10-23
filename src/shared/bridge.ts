import type { CommandArgs, CommandName, CommandResult, IpcResult } from './ipc';
import type { ReplicaMessage } from './state';
import type { TerminalEvent } from './terminal';

/** API the preload script exposes to the renderer as `window.forklift`. */
export interface ForkliftBridge {
  platform: string;
  invoke<K extends CommandName>(channel: K, ...args: CommandArgs<K>): Promise<IpcResult<CommandResult<K>>>;
  /** Messages received before the first listener attaches are buffered and replayed to it. */
  onReplicaMessage(listener: (message: ReplicaMessage) => void): () => void;
  ackReplicaUpdate(updateIndex: number): void;
  /** Filesystem path of a file or folder dropped on the window ('' when it has none). */
  pathForFile(file: File): string;
  /** Embedded terminals: output and exits from main, keystrokes to it (fire and forget). */
  terminal: {
    onEvent(listener: (event: TerminalEvent) => void): () => void;
    write(id: number, data: string): void;
  };
}
