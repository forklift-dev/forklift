import type { ReactNode } from 'react';
import { flowBranch, type FlowKind, type GitflowConfig } from '../../../shared/gitflow';
import type { RepoData } from '../../../shared/state';
import { invoke } from '../api';
import { useCommand } from '../useCommand';
import { useFormDialog } from './FormDialog';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
async function attempt(action: () => Promise<unknown>): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (error) {
    return errorText(error);
  }
}

export interface Gitflow {
  /** null: not set up; undefined: not read yet. */
  config: GitflowConfig | null | undefined;
  init(): void;
  start(kind: FlowKind): void;
  finish(branch: string): void;
  dialogs: ReactNode;
}

const LABEL: Record<FlowKind, string> = { feature: 'feature', release: 'release', hotfix: 'hotfix' };

/** Gitflow setup, start and finish dialogs for the open repository. */
export function useGitflow(repo: string, data: RepoData): Gitflow {
  const { data: config } = useCommand('gitflow:config', [repo], { reloadKey: data.loadedAt, keepPrevious: true });
  const { form, dialog } = useFormDialog();
  const production = data.branches.some((b) => b.name === 'main') ? 'main' : data.branches.some((b) => b.name === 'master') ? 'master' : (data.branch.head ?? 'main');

  return {
    config,
    init: () =>
      void form({
        title: 'Set up Gitflow',
        detail: 'Saved in this repository’s git config (gitflow.*), the way git-flow keeps it. The develop branch is created from production if it does not exist.',
        fields: [
          { name: 'production', label: 'Production branch', initial: config?.production ?? production },
          { name: 'develop', label: 'Development branch', initial: config?.develop ?? 'develop' },
          { name: 'feature', label: 'Feature prefix', initial: config?.feature ?? 'feature/' },
          { name: 'release', label: 'Release prefix', initial: config?.release ?? 'release/' },
          { name: 'hotfix', label: 'Hotfix prefix', initial: config?.hotfix ?? 'hotfix/' },
          { name: 'versionTag', label: 'Version tag prefix', initial: config?.versionTag ?? '', placeholder: 'e.g. v' },
        ],
        confirmLabel: 'Save',
        submit: (values) =>
          attempt(() =>
            invoke('gitflow:init', repo, {
              production: String(values['production']).trim(),
              develop: String(values['develop']).trim(),
              feature: String(values['feature']).trim(),
              release: String(values['release']).trim(),
              hotfix: String(values['hotfix']).trim(),
              versionTag: String(values['versionTag']).trim(),
            }),
          ),
      }),
    start: (kind) => {
      if (!config) return;
      const base = kind === 'hotfix' ? config.production : config.develop;
      void form({
        title: `Start a ${LABEL[kind]}`,
        detail: `A new branch ${kind === 'feature' ? config.feature : kind === 'release' ? config.release : config.hotfix}… from ${base}, checked out.`,
        fields: [{ name: 'name', label: kind === 'feature' ? 'Feature name' : 'Version', placeholder: kind === 'feature' ? 'login-form' : '1.2.0' }],
        confirmLabel: 'Start',
        validate: async (values) => (String(values['name']).trim() ? null : `Enter a ${kind === 'feature' ? 'name' : 'version'}`),
        submit: (values) => attempt(() => invoke('gitflow:start', repo, kind, String(values['name']).trim())),
      });
    },
    finish: (branch) => {
      const flow = config ? flowBranch(config, branch) : null;
      if (!config || !flow) return;
      const tagged = flow.kind !== 'feature';
      void form({
        title: `Finish ${branch}`,
        detail: tagged
          ? `Merged into ${config.production} and tagged ${config.versionTag}${flow.name}; the tag is merged back into ${config.develop}.`
          : `Merged into ${config.develop} (a merge commit).`,
        fields: [
          ...(tagged ? [{ name: 'tagMessage', label: 'Tag message', initial: `${flow.kind === 'release' ? 'Release' : 'Hotfix'} ${flow.name}` }] : []),
          { name: 'keepBranch', label: 'Keep the branch', type: 'checkbox' as const },
        ],
        confirmLabel: 'Finish',
        // On conflicts the message says to resolve them and finish again; the merge waits in the repository.
        submit: (values) => attempt(() => invoke('gitflow:finish', repo, branch, { keepBranch: values['keepBranch'] === true, ...(tagged && { tagMessage: String(values['tagMessage']) }) })),
      });
    },
    dialogs: dialog,
  };
}
