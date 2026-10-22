// libgit2 flag values. @types/nodegit declares these as ambient const enums, which
// isolatedModules cannot inline, so the stable C ABI values are mirrored here.

export const SORT = {
  TOPOLOGICAL: 1 << 0,
  TIME: 1 << 1,
} as const;

export const OBJECT_TYPE_COMMIT = 1;

export const STATUS_OPT = {
  INCLUDE_UNTRACKED: 1 << 0,
  RECURSE_UNTRACKED_DIRS: 1 << 4,
  RENAMES_HEAD_TO_INDEX: 1 << 7,
  RENAMES_INDEX_TO_WORKDIR: 1 << 8,
} as const;

export const STATUS = {
  INDEX_NEW: 1 << 0,
  INDEX_MODIFIED: 1 << 1,
  INDEX_DELETED: 1 << 2,
  INDEX_RENAMED: 1 << 3,
  INDEX_TYPECHANGE: 1 << 4,
  WT_NEW: 1 << 7,
  WT_MODIFIED: 1 << 8,
  WT_DELETED: 1 << 9,
  WT_TYPECHANGE: 1 << 10,
  WT_RENAMED: 1 << 11,
  CONFLICTED: 1 << 15,
} as const;

/** git_delta_t */
export const DELTA = {
  ADDED: 1,
  DELETED: 2,
  MODIFIED: 3,
  RENAMED: 4,
  COPIED: 5,
  TYPECHANGE: 8,
} as const;

export const DIFF_FLAG_BINARY = 1 << 0;
export const DIFF_FIND_RENAMES = 1 << 0;

export const INDEX_MASK =
  STATUS.INDEX_NEW | STATUS.INDEX_MODIFIED | STATUS.INDEX_DELETED | STATUS.INDEX_RENAMED | STATUS.INDEX_TYPECHANGE;

export const WORKTREE_MASK =
  STATUS.WT_NEW | STATUS.WT_MODIFIED | STATUS.WT_DELETED | STATUS.WT_TYPECHANGE | STATUS.WT_RENAMED;
