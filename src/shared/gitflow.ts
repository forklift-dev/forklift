/** Gitflow settings, kept in git config (gitflow.*) as git-flow and GitKraken do. */
export interface GitflowConfig {
  /** Production branch (gitflow.branch.master). */
  production: string;
  develop: string;
  feature: string;
  release: string;
  hotfix: string;
  /** Prefix of release and hotfix tags (gitflow.prefix.versiontag), often "" or "v". */
  versionTag: string;
}

export type FlowKind = 'feature' | 'release' | 'hotfix';

export interface FlowFinishOptions {
  /** Keep the branch after finishing. */
  keepBranch: boolean;
  /** Message of the release/hotfix tag. */
  tagMessage?: string;
}

/** The flow kind and name of a branch ("feature/login" → feature, "login"), or null. */
export function flowBranch(config: GitflowConfig, branch: string): { kind: FlowKind; name: string } | null {
  for (const kind of ['feature', 'release', 'hotfix'] as const) {
    const prefix = config[kind];
    if (prefix && branch.startsWith(prefix) && branch.length > prefix.length) return { kind, name: branch.slice(prefix.length) };
  }
  return null;
}
