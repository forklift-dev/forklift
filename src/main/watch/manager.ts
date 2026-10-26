import type { AppStore } from '../store';
import { t } from '../../shared/i18n';
import { noticeAdded } from '../store';
import { refreshRepo } from '../store/reposSlice';
import { Refresher } from './refresher';
import { RepoWatcher } from './watcher';

const INOTIFY_HINT = 'File watching stopped: the system limit of watched folders was reached (fs.inotify.max_user_watches). Changes made outside Forklift now show up when the window gets focus. To raise the limit: echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/90-forklift.conf && sudo sysctl --system';

/**
 * Keeps the active tab up to date with changes made outside the app (editors, git in a terminal):
 * one watcher for the active repository, re-read quietly after changes settle.
 */
export class WatchManager {
  private active: { id: string; watcher: Promise<RepoWatcher | null>; refresher: Refresher } | null = null;
  private unsubscribe: (() => void) | null = null;
  private warned = false;

  constructor(
    private readonly store: AppStore,
    private readonly startWatcher: typeof RepoWatcher.start = RepoWatcher.start,
    /** Operations of the app itself (stash, checkout…): a refresh waits for them instead of showing their middle. */
    private readonly idle: (root: string) => Promise<void> = async () => {},
  ) {}

  start(): void {
    this.sync();
    this.unsubscribe = this.store.subscribe(() => this.sync());
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    await this.switchTo(null);
  }

  /** Fallback for missed events (and the only source when watching failed): re-read the active tab. */
  refreshActive(): void {
    this.active?.refresher.request();
  }

  private sync(): void {
    const { activeId, tabs } = this.store.getState().repos.view;
    const tab = tabs.find((entry) => entry.id === activeId);
    // Watch only a repository that could be read; a missing one has nothing to watch.
    const id = tab && !tab.error ? tab.id : null;
    if (id !== (this.active?.id ?? null)) void this.switchTo(id);
  }

  private async switchTo(id: string | null): Promise<void> {
    const previous = this.active;
    this.active = null;
    if (previous) {
      previous.refresher.stop();
      void previous.watcher.then((watcher) => watcher?.stop());
    }
    if (!id) return;
    const refresher = new Refresher(async () => {
      // The operation re-reads the repository itself when it ends.
      await this.idle(id);
      if (this.store.getState().repos.byId[id]) await this.store.dispatch(refreshRepo(id));
    });
    const watcher = this.startWatcher(id, {
      changed: () => refresher.request(),
      failed: (error) => this.failed(error),
    }).catch((error: unknown) => {
      this.failed(error instanceof Error ? error : new Error(String(error)));
      return null;
    });
    this.active = { id, watcher, refresher };
    // Whatever changed while the tab was in the background.
    if (previous) refresher.request();
  }

  private failed(error: Error): void {
    console.error('[watch]', error);
    if (this.warned) return;
    this.warned = true;
    const inotify = process.platform === 'linux' && /ENOSPC|inotify|no space left/i.test(error.message);
    this.store.dispatch(noticeAdded(inotify ? t(INOTIFY_HINT) : t('File watching failed ({message}); changes show up when the window gets focus.', { message: error.message })));
  }
}
