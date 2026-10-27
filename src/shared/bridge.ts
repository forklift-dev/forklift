import type { CommandArgs, CommandName, CommandResult, IpcResult } from './ipc';
import type { ReplicaMessage } from './state';
import type { TerminalEvent } from './terminal';
import type { FileDiff } from './diff';

/** API the preload script exposes to the renderer as `window.forklift`. */
export interface ForkliftBridge {
  platform: string;
  invoke<K extends CommandName>(channel: K, ...args: CommandArgs<K>): Promise<IpcResult<CommandResult<K>>>;
  /** Messages received before the first listener attaches are buffered and replayed to it. */
  onReplicaMessage(listener: (message: ReplicaMessage) => void): () => void;
  ackReplicaUpdate(updateIndex: number): void;
  /** Filesystem path of a file or folder dropped on the window ('' when it has none). */
  pathForFile(file: File): string;
  /** Data for the isolated `git difftool` window; paths remain in the main process. */
  toolDiff(): Promise<{ path: string; diff: FileDiff }>;
  /** Embedded terminals: output and exits from main, keystrokes to it (fire and forget). */
  terminal: {
    onEvent(listener: (event: TerminalEvent) => void): () => void;
    write(id: number, data: string): void;
  };
}
