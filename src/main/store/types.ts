import type { GitService } from '../git/service';

/** Dependencies injected into thunks, so they can be replaced in tests. */
export interface ThunkExtra {
  git: GitService;
}
