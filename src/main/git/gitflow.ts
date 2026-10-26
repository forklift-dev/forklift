import { flowBranch, type FlowFinishOptions, type FlowKind, type GitflowConfig } from '../../shared/gitflow';
import { t } from '../../shared/i18n';
import { GitCliError, type GitCli } from './cli';
import { RepoQueue } from './repoQueue';

export class GitflowError extends Error {
  constructor(
    message: string,
    /** A merge stopped with conflicts: resolve, commit, then finish again. */
    readonly conflicts = false,
  ) {
    super(message);
    this.name = 'GitflowError';
  }
}

const KEYS: Record<keyof GitflowConfig, string> = {
  production: 'gitflow.branch.master',
  develop: 'gitflow.branch.develop',
  feature: 'gitflow.prefix.feature',
  release: 'gitflow.prefix.release',
  hotfix: 'gitflow.prefix.hotfix',
  versionTag: 'gitflow.prefix.versiontag',
};

const NAME = /^[^-\s][^\s]{0,200}$/;

/**
 * Gitflow with plain git: start creates the branch from develop (hotfix: from production); finish merges a
 * feature into develop, a release or hotfix into production (--no-ff), tags it and merges the tag back into
 * develop, then deletes the branch. Every finish step is skipped when
 * already done, so after resolving a conflict the same finish completes the rest.
 */
export class GitflowService {
  constructor(
    private readonly git: GitCli,
    private readonly queue = new RepoQueue(),
  ) {}

  /** The configuration, or null when the repository is not set up for Gitflow. */
  async config(root: string): Promise<GitflowConfig | null> {
    const { stdout } = await this.git.exec(['config', '--get-regexp', '^gitflow\\.'], { cwd: root, readOnly: true, allowedExitCodes: [1] });
    const values = new Map(stdout.split('\n').filter(Boolean).map((line) => [line.slice(0, line.indexOf(' ')).toLowerCase(), line.slice(line.indexOf(' ') + 1)]));
    const get = (key: keyof GitflowConfig) => values.get(KEYS[key].toLowerCase());
    if (!get('production') || !get('develop')) return null;
    return { production: get('production')!, develop: get('develop')!, feature: get('feature') ?? 'feature/', release: get('release') ?? 'release/', hotfix: get('hotfix') ?? 'hotfix/', versionTag: get('versionTag') ?? '' };
  }

  /** Writes the configuration; creates develop from the production branch when it does not exist. */
  async init(root: string, raw: unknown): Promise<GitflowConfig> {
    const config = this.parseConfig(raw);
    return this.queue.run(root, async () => {
      if (!(await this.branchExists(root, config.production))) throw new GitflowError(t('There is no branch {branch} to use for production', { branch: config.production }));
      if (!(await this.branchExists(root, config.develop))) await this.exec(root, ['branch', '--', config.develop, config.production]);
      for (const [key, name] of Object.entries(KEYS)) await this.exec(root, ['config', name, config[key as keyof GitflowConfig]]);
      return config;
    });
  }

  /** Creates and checks out `<prefix><name>` from develop (a hotfix from production). */
  async start(root: string, kind: FlowKind, name: unknown): Promise<string> {
    const config = await this.require(root);
    if (typeof name !== 'string' || !NAME.test(name.trim())) throw new GitflowError(kind === 'feature' ? t('Enter a name') : t('Enter a version'));
    const branch = `${config[kind]}${name.trim()}`;
    await this.assertBranchName(root, branch);
    return this.queue.run(root, async () => {
      if (await this.branchExists(root, branch)) throw new GitflowError(t('{path} already exists', { path: branch }));
      if (kind !== 'feature') {
        const open = (await this.branches(root)).find((b) => b.startsWith(config[kind]));
        if (open) {
          const kindName = kind === 'release' ? t('flow|release') : t('flow|hotfix');
          throw new GitflowError(t('{branch} is not finished yet: finish it before starting another {kind}', { branch: open, kind: kindName }));
        }
      }
      await this.exec(root, ['checkout', '-b', branch, kind === 'hotfix' ? config.production : config.develop]);
      return branch;
    });
  }

  /** Merges the flow branch back, tags releases and hotfixes, deletes the branch; ends on develop. */
  async finish(root: string, branch: unknown, options: FlowFinishOptions): Promise<void> {
    const config = await this.require(root);
    const flow = typeof branch === 'string' ? flowBranch(config, branch) : null;
    if (!flow || typeof branch !== 'string') throw new GitflowError(t('Choose a feature, release or hotfix branch'));
    const tagMessage = options.tagMessage?.trim() || `${flow.kind === 'release' ? 'Release' : 'Hotfix'} ${flow.name}`;
    await this.queue.run(root, async () => {
      if (!(await this.branchExists(root, branch))) throw new GitflowError(t('There is no branch {branch}', { branch }));
      const dirty = (await this.git.exec(['status', '--porcelain', '--untracked-files=no'], { cwd: root, readOnly: true })).stdout.trim();
      if (dirty) throw new GitflowError(t('Commit or stash your changes first: finishing merges branches'));
      if (flow.kind === 'feature') await this.mergeInto(root, config.develop, branch);
      else {
        await this.mergeInto(root, config.production, branch);
        const tag = `${config.versionTag}${flow.name}`;
        if (!(await this.refExists(root, `refs/tags/${tag}`))) await this.exec(root, ['tag', '-a', '-m', tagMessage, '--', tag, config.production]);
        // As git-flow does: develop gets the tagged production commit ("back-merge"), so it contains the release.
        await this.mergeInto(root, config.develop, tag);
      }
      if (!options.keepBranch) await this.exec(root, ['branch', '-d', '--', branch]);
    });
  }

  private async mergeInto(root: string, target: string, branch: string): Promise<void> {
    if (await this.isAncestor(root, branch, target)) return;
    await this.exec(root, ['checkout', target]);
    try {
      await this.exec(root, ['merge', '--no-ff', '--no-edit', branch]);
    } catch (error) {
      const conflicted = (await this.git.exec(['diff', '--name-only', '--diff-filter=U'], { cwd: root, readOnly: true })).stdout.trim();
      if (conflicted) throw new GitflowError(t('Merging {branch} into {target} stopped with conflicts. Resolve them and commit the merge, then finish again.', { branch, target }), true);
      throw error;
    }
  }

  private async require(root: string): Promise<GitflowConfig> {
    const config = await this.config(root);
    if (!config) throw new GitflowError(t('Gitflow is not set up in this repository'));
    return config;
  }

  private parseConfig(raw: unknown): GitflowConfig {
    if (typeof raw !== 'object' || raw === null) throw new GitflowError(t('Enter the Gitflow settings'));
    const values = raw as Record<string, unknown>;
    const text = (key: keyof GitflowConfig, allowEmpty: boolean) => {
      const value = values[key];
      if (typeof value !== 'string' || /[\s\0~^:?*[\\]/.test(value) || value.startsWith('-') || (!allowEmpty && !value)) throw new GitflowError(t('"{value}" is not valid for {key}', { value: String(value), key }));
      return value;
    };
    const config: GitflowConfig = {
      production: text('production', false),
      develop: text('develop', false),
      feature: text('feature', false),
      release: text('release', false),
      hotfix: text('hotfix', false),
      versionTag: text('versionTag', true),
    };
    if (config.production === config.develop) throw new GitflowError(t('Production and develop must be different branches'));
    return config;
  }

  private async branches(root: string): Promise<string[]> {
    const { stdout } = await this.git.exec(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { cwd: root, readOnly: true });
    return stdout.split('\n').filter(Boolean);
  }

  private branchExists(root: string, name: string): Promise<boolean> {
    return this.refExists(root, `refs/heads/${name}`);
  }

  private async refExists(root: string, ref: string): Promise<boolean> {
    return (await this.git.exec(['show-ref', '--verify', '--quiet', ref], { cwd: root, readOnly: true, allowedExitCodes: [1] })).exitCode === 0;
  }

  private async isAncestor(root: string, ancestor: string, of: string): Promise<boolean> {
    return (await this.git.exec(['merge-base', '--is-ancestor', ancestor, of], { cwd: root, readOnly: true, allowedExitCodes: [1] })).exitCode === 0;
  }

  private async assertBranchName(root: string, name: string): Promise<void> {
    const { exitCode } = await this.git.exec(['check-ref-format', '--branch', name], { cwd: root, readOnly: true, allowedExitCodes: [1, 128] });
    if (exitCode !== 0) throw new GitflowError(t('"{name}" is not a valid branch name', { name }));
  }

  private async exec(root: string, args: string[]): Promise<void> {
    try {
      await this.git.exec(args, { cwd: root });
    } catch (error) {
      if (error instanceof GitCliError) throw new GitflowError(error.message.replace(/^git .*? failed: (error: |fatal: )?/, ''));
      throw error;
    }
  }
}
