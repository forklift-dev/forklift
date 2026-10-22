import type { GitService } from '../git/service';
import type { AppStore } from '../store';
import { repoVisited } from '../store/librarySlice';
import { loadRepo, tabOpened } from '../store/reposSlice';

/** Opens (or activates) a tab for the repository containing `path`; resolves to its id, the repository root. */
export async function openRepository(store: AppStore, git: Pick<GitService, 'resolveRoot'>, path: string, activate = true): Promise<string> {
  const root = await git.resolveRoot(path);
  const existing = store.getState().repos.byId[root];
  store.dispatch(tabOpened({ id: root, activate }));
  // A new tab, or one whose earlier read failed, is read now; an open one is just switched to.
  if (!existing?.data || existing.error) await store.dispatch(loadRepo(root)).unwrap();
  store.dispatch(repoVisited({ path: root, at: Date.now() }));
  return root;
}
