import { contextBridge, ipcRenderer } from 'electron';
import type { ForkliftBridge } from '../shared/bridge';
import { isCommandName } from '../shared/ipc';
import { REPLICA_READY_CHANNEL, type ReplicaAck, type ReplicaMessage } from '../shared/state';

// The replication port stays inside the preload; the page only receives plain messages.
const { port1, port2 } = new MessageChannel();
ipcRenderer.postMessage(REPLICA_READY_CHANNEL, null, [port1]);

const buffered: ReplicaMessage[] = [];
const listeners = new Set<(message: ReplicaMessage) => void>();

port2.onmessage = (event: MessageEvent<ReplicaMessage>) => {
  if (listeners.size === 0) buffered.push(event.data);
  for (const listener of listeners) listener(event.data);
};

const bridge: ForkliftBridge = {
  platform: process.platform,

  invoke(channel, ...args) {
    if (!isCommandName(channel)) return Promise.reject(new Error(`Unknown command: ${String(channel)}`));
    return ipcRenderer.invoke(channel, ...args);
  },

  onReplicaMessage(listener) {
    listeners.add(listener);
    for (const message of buffered.splice(0)) listener(message);
    return () => {
      listeners.delete(listener);
    };
  },

  ackReplicaUpdate(updateIndex) {
    port2.postMessage({ updateIndex } satisfies ReplicaAck);
  },
};

contextBridge.exposeInMainWorld('forklift', bridge);
