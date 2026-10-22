import type { GitService } from '../git/service';
import { openRepository } from './open';
import type { AppStore } from '../store';
import { libraryLoaded } from '../store/librarySlice';
import { loadRepo, tabActivated, tabOpened } from '../store/reposSlice';
import type { LibraryFile } from './libraryFile';

/** Remembers open tabs, recent and favorite repositories across runs (userData/repositories.json). */
export class RepoSession {
  constructor(
    private readonly store: AppStore,
    private readonly file: LibraryFile,
  ) {}

  /** Loads what was remembered; with `restoreTabs`, reopens the tabs (only the active one is read now). */
  async load(restoreTabs: boolean): Promise<void> {
    const { store } = this;
    const { session, library } = await this.file.load();
    store.dispatch(libraryLoaded(library));
    if (restoreTabs && session.tabs.length) {
      for (const id of session.tabs) store.dispatch(tabOpened({ id, activate: false }));
      const active = session.active ?? session.tabs[0]!;
      store.dispatch(tabActivated(active));
      // Not awaited: the window shows the tabs while the active repository is read; a missing one gets an error.
      void store.dispatch(loadRepo(active));
    }

    const snapshot = () => {
      const { repos, library: current } = store.getState();
      return { key: JSON.stringify([repos.view.tabs.map((tab) => tab.id), repos.view.activeId]), library: current };
    };
    let saved = snapshot();
    store.subscribe(() => {
      const next = snapshot();
      // Loading flags change the tab list often; only the ids, their order and the active tab are remembered.
      if (next.key === saved.key && next.library === saved.library) return;
      saved = next;
      const { view } = store.getState().repos;
      this.file
        .save({ session: { tabs: view.tabs.map((tab) => tab.id), active: view.activeId }, library: next.library })
        .catch((error: unknown) => console.error('[repos] could not save the session:', error));
    });
  }

  /** Opens a repository named outside the window (command line, a second launch); failures become notices. */
  open(git: Pick<GitService, 'resolveRoot'>, path: string, report: (message: string) => void): Promise<void> {
    return openRepository(this.store, git, path).then(
      () => {},
      (error: unknown) => report(`Could not open ${path}: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
}
