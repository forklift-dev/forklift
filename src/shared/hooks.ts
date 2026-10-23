/** Client-side hooks git runs for the operations the app starts. */
export const COMMIT_HOOKS = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit'] as const;
export const PUSH_HOOKS = ['pre-push'] as const;

export interface HooksInfo {
  /** Where git looks for hooks (core.hooksPath, or .git/hooks). */
  dir: string;
  /** Hooks present there (executable). */
  hooks: string[];
}

/** Hooks running in a tab's commit or push, with what they print so far. */
export interface HookActivity {
  operation: 'commit' | 'push';
  hooks: string[];
  /** Last lines of output (hooks and git). */
  output: string[];
}
