import type { GitCli } from '../git/cli';
import { gitToolCommand } from './diffTools';

export type GitToolScope = 'global' | 'local';

const OWNED_KEYS = ['diff.tool', 'difftool.forklift.cmd', 'merge.tool', 'mergetool.forklift.cmd', 'mergetool.forklift.trustExitCode'] as const;
const BACKUP_KEY = 'forklift.setup.backup';
type Backup = Partial<Record<(typeof OWNED_KEYS)[number], string[]>>;

export interface GitConfigChange {
  key: string;
  values: string[];
}

/** Registers Forklift as the selected Git diff and merge tool, preserving values for uninstall. */
export class GitToolSetup {
  constructor(private readonly git: GitCli) {}

  async setup(cwd: string, scope: GitToolScope, executable: readonly string[], dryRun = false): Promise<GitConfigChange[]> {
    const scopeArgs = scope === 'global' ? ['--global'] : ['--local'];
    const existingBackup = await this.get(cwd, scopeArgs, BACKUP_KEY);
    if (existingBackup.length) throw new Error(`Forklift is already configured in ${scope} Git config`);

    const diffCommand = gitToolCommand(executable[0]!, [
      ...executable.slice(1), 'difftool', '--local', '$LOCAL', '--remote', '$REMOTE', '--path', '$MERGED',
    ]);
    const mergeCommand = gitToolCommand(executable[0]!, [
      ...executable.slice(1), 'mergetool', '--base', '$BASE', '--local', '$LOCAL', '--remote', '$REMOTE', '--merged', '$MERGED',
    ]);
    const changes: GitConfigChange[] = [
      { key: 'diff.tool', values: ['forklift'] },
      { key: 'difftool.forklift.cmd', values: [diffCommand] },
      { key: 'merge.tool', values: ['forklift'] },
      { key: 'mergetool.forklift.cmd', values: [mergeCommand] },
      { key: 'mergetool.forklift.trustExitCode', values: ['true'] },
    ];
    if (dryRun) return changes;

    const backup: Backup = {};
    for (const { key } of changes) {
      const values = await this.get(cwd, scopeArgs, key);
      if (values.length) backup[key as keyof Backup] = values;
    }
    // Write the recovery record first. A failed write can then be undone by uninstall.
    await this.replace(cwd, scopeArgs, BACKUP_KEY, [JSON.stringify(backup)]);
    try {
      for (const change of changes) await this.replace(cwd, scopeArgs, change.key, change.values);
    } catch (error) {
      await this.restore(cwd, scopeArgs, backup, changes.map(({ key }) => key));
      await this.unset(cwd, scopeArgs, BACKUP_KEY);
      throw error;
    }
    return changes;
  }

  async uninstall(cwd: string, scope: GitToolScope, dryRun = false): Promise<GitConfigChange[]> {
    const scopeArgs = scope === 'global' ? ['--global'] : ['--local'];
    const stored = await this.get(cwd, scopeArgs, BACKUP_KEY);
    if (!stored.length) throw new Error(`Forklift is not configured in ${scope} Git config`);
    let backup: Backup;
    try {
      backup = JSON.parse(stored[0]!) as Backup;
    } catch {
      throw new Error('Forklift Git config backup is invalid; no settings were changed');
    }
    const changes = OWNED_KEYS.map((key) => ({ key, values: backup[key] ?? [] }));
    if (dryRun) return changes;
    for (const change of changes) {
      if (change.values.length) await this.replace(cwd, scopeArgs, change.key, change.values);
      else await this.unset(cwd, scopeArgs, change.key);
    }
    await this.unset(cwd, scopeArgs, BACKUP_KEY);
    return changes;
  }

  private async get(cwd: string, scope: string[], key: string): Promise<string[]> {
    const { stdout } = await this.git.exec(['config', ...scope, '--null', '--get-all', key], { cwd, readOnly: true, allowedExitCodes: [1] });
    return stdout.split('\0').filter(Boolean);
  }

  private async replace(cwd: string, scope: string[], key: string, values: string[]): Promise<void> {
    await this.unset(cwd, scope, key);
    for (const value of values) await this.git.exec(['config', ...scope, '--add', key, value], { cwd });
  }

  private async unset(cwd: string, scope: string[], key: string): Promise<void> {
    await this.git.exec(['config', ...scope, '--unset-all', key], { cwd, allowedExitCodes: [1, 5] });
  }

  private async restore(cwd: string, scope: string[], backup: Backup, keys: string[]): Promise<void> {
    for (const key of keys) {
      const values = backup[key as keyof Backup] ?? [];
      if (values.length) await this.replace(cwd, scope, key, values);
      else await this.unset(cwd, scope, key);
    }
  }
}
