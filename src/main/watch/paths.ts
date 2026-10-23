import { relative, sep } from 'node:path';

/** Files inside the git directory whose change means the repository state changed. */
const GIT_STATE = /^(HEAD|ORIG_HEAD|MERGE_HEAD|MERGE_MSG|CHERRY_PICK_HEAD|REVERT_HEAD|REBASE_HEAD|BISECT_LOG|index|packed-refs|config|refs\/.*|rebase-merge(\/.*)?|rebase-apply(\/.*)?|sequencer(\/.*)?|modules\/[^/]+\/(HEAD|index|refs\/.*))$/;

export type ChangedPath = { kind: 'git' } | { kind: 'worktree'; path: string } | { kind: 'none' };

/**
 * Sorts a changed path: state files of the git directory count, its objects, logs and lock files
 * do not (they churn during fetch and gc, and every write ends in a rename of the real file anyway);
 * working tree paths are returned relative to the root, in git's form, for the ignore check.
 */
export function classifyPath(path: string, root: string, gitDir: string): ChangedPath {
  const inGit = relative(gitDir, path);
  if (inGit === '' || (!inGit.startsWith('..') && !inGit.startsWith(sep) && !/^[a-zA-Z]:/.test(inGit))) {
    const name = inGit.split(sep).join('/');
    if (name.endsWith('.lock')) return { kind: 'none' };
    return GIT_STATE.test(name) ? { kind: 'git' } : { kind: 'none' };
  }
  const inTree = relative(root, path);
  if (inTree === '' || inTree.startsWith('..') || /^[a-zA-Z]:/.test(inTree)) return { kind: 'none' };
  return { kind: 'worktree', path: inTree.split(sep).join('/') };
}
