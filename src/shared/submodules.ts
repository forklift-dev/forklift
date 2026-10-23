/** A submodule of the open repository (not nested ones: those show when the submodule is opened). */
export interface SubmoduleInfo {
  name: string;
  /** Relative to the repository root. */
  path: string;
  url: string;
  /**
   * uninitialized: not cloned yet; current: at the commit the repository records; moved: at another commit
   * (new commits inside, or the recorded one changed); conflict: a merge conflict on the submodule.
   */
  state: 'uninitialized' | 'current' | 'moved' | 'conflict';
  /** Commit the repository records for it. */
  recorded: string | null;
  /** Commit checked out in it. */
  checkedOut: string | null;
  /** Uncommitted changes (or untracked files) inside. */
  dirty: boolean;
}
