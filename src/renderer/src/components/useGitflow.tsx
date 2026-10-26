import type { ReactNode } from 'react';
import { flowBranch, type FlowKind, type GitflowConfig } from '../../../shared/gitflow';
import { t } from '../../../shared/i18n';
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

/** Gitflow setup, start and finish dialogs for the open repository. */
export function useGitflow(repo: string, data: RepoData): Gitflow {
  const { data: config } = useCommand('gitflow:config', [repo], { reloadKey: data.loadedAt, keepPrevious: true });
  const { form, dialog } = useFormDialog();
  const production = data.branches.some((b) => b.name === 'main') ? 'main' : data.branches.some((b) => b.name === 'master') ? 'master' : (data.branch.head ?? 'main');

  return {
    config,
    init: () =>
      void form({
        title: t('Set up Gitflow'),
        detail: t('Saved in this repository’s git config (gitflow.*), the way git-flow keeps it. The develop branch is created from production if it does not exist.'),
        fields: [
          { name: 'production', label: t('Production branch'), initial: config?.production ?? production },
          { name: 'develop', label: t('Development branch'), initial: config?.develop ?? 'develop' },
          { name: 'feature', label: t('Feature prefix'), initial: config?.feature ?? 'feature/' },
          { name: 'release', label: t('Release prefix'), initial: config?.release ?? 'release/' },
          { name: 'hotfix', label: t('Hotfix prefix'), initial: config?.hotfix ?? 'hotfix/' },
          { name: 'versionTag', label: t('Version tag prefix'), initial: config?.versionTag ?? '', placeholder: t('e.g. v') },
        ],
        confirmLabel: t('Save'),
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
        title: kind === 'feature' ? t('Start a feature') : kind === 'release' ? t('Start a release') : t('Start a hotfix'),
        detail: t('A new branch {prefix}… from {base}, checked out.', { prefix: kind === 'feature' ? config.feature : kind === 'release' ? config.release : config.hotfix, base }),
        fields: [{ name: 'name', label: kind === 'feature' ? t('Feature name') : t('Version'), placeholder: kind === 'feature' ? 'login-form' : '1.2.0' }],
        confirmLabel: t('Start'),
        validate: async (values) => (String(values['name']).trim() ? null : kind === 'feature' ? t('Enter a name') : t('Enter a version')),
        submit: (values) => attempt(() => invoke('gitflow:start', repo, kind, String(values['name']).trim())),
      });
    },
    finish: (branch) => {
      const flow = config ? flowBranch(config, branch) : null;
      if (!config || !flow) return;
      const tagged = flow.kind !== 'feature';
      void form({
        title: t('Finish {branch}', { branch }),
        detail: tagged
          ? t('Merged into {production} and tagged {tag}; the tag is merged back into {develop}.', { production: config.production, tag: `${config.versionTag}${flow.name}`, develop: config.develop })
          : t('Merged into {develop} (a merge commit).', { develop: config.develop }),
        fields: [
          ...(tagged ? [{ name: 'tagMessage', label: t('Tag message'), initial: flow.kind === 'release' ? t('Release {name}', { name: flow.name }) : t('Hotfix {name}', { name: flow.name }) }] : []),
          { name: 'keepBranch', label: t('Keep the branch'), type: 'checkbox' as const },
        ],
        confirmLabel: t('Finish'),
        // On conflicts the message says to resolve them and finish again; the merge waits in the repository.
        submit: (values) => attempt(() => invoke('gitflow:finish', repo, branch, { keepBranch: values['keepBranch'] === true, ...(tagged && { tagMessage: String(values['tagMessage']) }) })),
      });
    },
    dialogs: dialog,
  };
}
