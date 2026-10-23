import type { OperationLog } from '../log/operationLog';
import type { RemoteService } from '../git/remote';
import type { SettingsService } from '../settings/service';
import { noticeAdded, type AppStore } from '../store';
import { refreshRepo } from '../store/reposSlice';
import type { NetworkOps } from './network';

export interface AutoFetchDeps {
  store: AppStore;
  settings: SettingsService;
  networkOps: NetworkOps;
  remotes: Pick<RemoteService, 'fetch'>;
  /** Background fetches appear in the operation log too. */
  log?: Pick<OperationLog, 'operation'>;
  /** Whether a window has focus: auto-fetch pauses while the app is in the background. */
  isFocused(): boolean;
  now?(): number;
}

const CHECK_EVERY_MS = 30_000;

/**
 * Fetches the active repository every N minutes (settings) while a window has focus. Never asks for
 * credentials; a repository that needs them is reported once and then skipped until fetched by hand.
 */
export class AutoFetch {
  private readonly lastFetch = new Map<string, number>();
  private readonly needsCredentials = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: AutoFetchDeps) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), CHECK_EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** A fetch done by hand counts too, and clears the "needs credentials" mark. */
  fetched(root: string): void {
    this.lastFetch.set(root, this.now());
    this.needsCredentials.delete(root);
  }

  /** One check: fetch the active repository if it is due. Resolves to whether it fetched. */
  async tick(): Promise<boolean> {
    const { store, settings, networkOps, remotes, isFocused, log } = this.deps;
    const values = settings.values;
    const root = store.getState().repos.view.activeId;
    if (!values['general.autoFetch'] || !root || !isFocused()) return false;
    const data = store.getState().repos.byId[root]?.data;
    if (!data || data.remotes.length === 0 || data.operation || networkOps.isRunning(root) || this.needsCredentials.has(root)) return false;
    const last = this.lastFetch.get(root);
    if (last === undefined) {
      // The first check after opening only starts the clock: opening a repository does not fetch it.
      this.lastFetch.set(root, this.now());
      return false;
    }
    if (this.now() - last < values['general.autoFetchMinutes'] * 60_000) return false;
    this.lastFetch.set(root, this.now());
    try {
      const fetch = () => networkOps.run(root, 'fetch', (run) => remotes.fetch(root, null, values['general.fetchPrune'], run, false));
      await (log ? log.operation('auto-fetch', root, fetch) : fetch());
      if (store.getState().repos.byId[root]) await store.dispatch(refreshRepo(root));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Authentication|could not read Username|terminal prompts disabled|Permission denied|askpass/i.test(message)) {
        this.needsCredentials.add(root);
        store.dispatch(noticeAdded(`Auto-fetch of ${data.name} needs credentials. Use Fetch once to sign in; auto-fetch then uses the saved ones (if your credential helper keeps them).`));
      } else {
        console.error(`[auto-fetch] ${root}:`, message);
      }
      return false;
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
}
