import type { RemoteProgress, RemoteRun } from '../git/remote';
import type { AppStore } from '../store';
import { remoteActivity } from '../store/reposSlice';

export type NetworkKind = 'fetch' | 'pull' | 'push';

/**
 * Tracks the one network operation a tab may run at a time: its cancel handle and its progress in the
 * replicated state (at most every 100 ms). Shared by window commands and the background auto-fetch.
 */
export class NetworkOps {
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly store: AppStore) {}

  isRunning(root: string): boolean {
    return this.running.has(root);
  }

  cancel(root: string): void {
    this.running.get(root)?.abort();
  }

  async run<T>(root: string, kind: NetworkKind, work: (run: RemoteRun) => Promise<T>): Promise<T> {
    if (this.running.has(root)) throw new Error('A fetch, pull or push is already running in this repository');
    const controller = new AbortController();
    this.running.set(root, controller);
    let last = 0;
    this.store.dispatch(remoteActivity({ id: root, activity: { kind, phase: null, percent: null } }));
    try {
      return await work({
        signal: controller.signal,
        onProgress: ({ phase, percent }: RemoteProgress) => {
          const now = Date.now();
          if (now - last < 100 && percent !== 100) return;
          last = now;
          this.store.dispatch(remoteActivity({ id: root, activity: { kind, phase, percent } }));
        },
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`The ${kind} was cancelled`, { cause: error });
      throw error;
    } finally {
      this.running.delete(root);
      this.store.dispatch(remoteActivity({ id: root, activity: null }));
    }
  }
}
