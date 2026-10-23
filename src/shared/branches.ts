/** What to switch to: a local branch, a remote branch (a local tracking branch is created) or a commit (detached). */
export type CheckoutTarget =
  | { kind: 'branch'; name: string }
  | { kind: 'remote'; name: string; remote: string }
  | { kind: 'commit'; sha: string };
