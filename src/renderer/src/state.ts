import { useSyncExternalStore } from 'react';
import type { AppState } from '../../shared/state';

// Read-only replica of the main-process store. Writes go through `invoke` commands.

let state: AppState | undefined;
let updateIndex = -1;
const listeners = new Set<() => void>();

let markReady!: () => void;
/** Resolves when the first full snapshot has arrived. */
export const stateReady = new Promise<void>((resolve) => {
  markReady = resolve;
});

window.forklift.onReplicaMessage((message) => {
  if (message.type === 'STATE') {
    state = message.state;
    markReady();
  } else if (state && message.updateIndex > updateIndex) {
    state = { ...state, ...message.slices };
  } else {
    return;
  }
  updateIndex = message.updateIndex;
  window.forklift.ackReplicaUpdate(updateIndex);
  for (const listener of listeners) listener();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getState(): AppState {
  if (!state) throw new Error('State replica is not initialized yet; await stateReady first');
  return state;
}

/** Selectors must return existing references (slices, fields), not freshly built objects. */
export function useAppState<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getState()));
}
