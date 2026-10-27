import type { CommandArgs, CommandName, CommandResult, IpcResult } from './ipc';
import type { ReplicaMessage } from './state';
import type { TerminalEvent } from './terminal';
import type { FileDiff, FileVersion } from './diff';
import type { Language } from './i18n';

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
  toolDiff(): Promise<{ path: string; diff: FileDiff; language: Language }>;
  /** Merge sides for the isolated `git mergetool` window. */
  toolMerge(): Promise<{ path: string; base: FileVersion; local: FileVersion; remote: FileVersion; merged: FileVersion; language: Language }>;
  /** Reports that the merge result was edited, so the main window can guard closing. */
  toolMergeDirty(): void;
  /** Writes the explicitly saved result to Git's MERGED path. */
  saveToolMerge(text: string): Promise<void>;
  /** Embedded terminals: output and exits from main, keystrokes to it (fire and forget). */
  terminal: {
    onEvent(listener: (event: TerminalEvent) => void): () => void;
    write(id: number, data: string): void;
  };
}
