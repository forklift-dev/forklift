import { ipcMain, type MessagePortMain } from 'electron';
import { REPLICA_READY_CHANNEL, type AppState, type ReplicaAck, type ReplicaMessage, type SliceName } from '../shared/state';
import { isTrustedSender } from './origin';
import type { AppStore } from './store';

interface Replica {
  port: MessagePortMain;
  sentIndex: number;
  ackedIndex: number;
  waiters: Array<{ index: number; resolve: () => void }>;
}

const ACK_TIMEOUT_MS = 5000;

export interface Replication {
  /** Resolves once the renderer has applied every update sent to it so far. */
  waitForAck(webContentsId: number): Promise<void>;
}

/**
 * Mirrors the main-process store into each renderer over a dedicated MessagePort:
 * a full STATE snapshot on connect, then UPDATE messages with changed top-level slices.
 */
export function startReplication(store: AppStore): Replication {
  const replicas = new Map<number, Replica>();
  let updateIndex = 0;
  let lastState = store.getState();

  const send = (replica: Replica, message: ReplicaMessage) => {
    replica.sentIndex = message.updateIndex;
    replica.port.postMessage(message);
  };

  const flushWaiters = (replica: Replica, force = false) => {
    replica.waiters = replica.waiters.filter((waiter) => {
      if (!force && waiter.index > replica.ackedIndex) return true;
      waiter.resolve();
      return false;
    });
  };

  store.subscribe(() => {
    const state = store.getState();
    if (state === lastState) return;

    const slices: Partial<AppState> = {};
    for (const key of Object.keys(state) as SliceName[]) {
      if (state[key] !== lastState[key]) Object.assign(slices, { [key]: state[key] });
    }
    lastState = state;
    if (Object.keys(slices).length === 0) return;

    updateIndex += 1;
    for (const replica of replicas.values()) send(replica, { type: 'UPDATE', updateIndex, slices });
  });

  const disconnect = (id: number) => {
    const replica = replicas.get(id);
    if (!replica) return;
    replicas.delete(id);
    replica.port.close();
    flushWaiters(replica, true);
  };

  ipcMain.on(REPLICA_READY_CHANNEL, (event) => {
    const [port] = event.ports;
    if (!port || !isTrustedSender(event.senderFrame)) return;

    const id = event.sender.id;
    const reconnect = replicas.has(id); // page reload re-sends REPLICA_READY on the same webContents
    disconnect(id);

    const replica: Replica = { port, sentIndex: 0, ackedIndex: 0, waiters: [] };
    replicas.set(id, replica);

    port.on('message', ({ data }: { data: ReplicaAck }) => {
      if (typeof data?.updateIndex !== 'number') return;
      replica.ackedIndex = Math.max(replica.ackedIndex, data.updateIndex);
      flushWaiters(replica);
    });
    port.start();
    send(replica, { type: 'STATE', updateIndex, state: store.getState() });

    if (!reconnect) event.sender.once('destroyed', () => disconnect(id));
  });

  return {
    waitForAck(webContentsId) {
      const replica = replicas.get(webContentsId);
      if (!replica || replica.ackedIndex >= replica.sentIndex) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, ACK_TIMEOUT_MS);
        replica.waiters.push({
          index: replica.sentIndex,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      });
    },
  };
}
