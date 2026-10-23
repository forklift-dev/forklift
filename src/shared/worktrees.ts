/** A working tree of the repository (`git worktree list`). */
export interface WorktreeInfo {
  path: string;
  /** Checked-out commit; null in a bare main repository. */
  head: string | null;
  /** Checked-out branch (short name), or null when detached. */
  branch: string | null;
  bare: boolean;
  /** The main working tree (the others are linked to it). */
  main: boolean;
  /** The repository this tab shows. */
  current: boolean;
  /** Why it is locked, '' when locked without a reason, null when not locked. */
  locked: string | null;
  /** Its folder is gone: `prune` would remove it. */
  prunable: boolean;
}

export interface WorktreeAddRequest {
  /** New folder, absolute. */
  path: string;
  /** Existing local branch to check out, or null to create `newBranch` at HEAD. */
  branch: string | null;
  newBranch: string | null;
}
