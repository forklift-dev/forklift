import type { GitCli } from '../git/cli';
import { gitToolCommand } from './diffTools';

export type GitToolScope = 'global' | 'local';

const OWNED_KEYS = ['diff.tool', 'difftool.forklift.cmd', 'merge.tool', 'mergetool.forklift.cmd', 'mergetool.forklift.trustExitCode'] as const;
const BACKUP_KEY = 'forklift.setup.backup';
type Backup = Partial<Record<(typeof OWNED_KEYS)[number], string[]>>;
interface BackupRecord { original: Backup; installed: Backup }

export interface GitConfigChange {
  key: string;
  values: string[];
  skipped?: boolean;
}

function validBackup(value: unknown): value is Backup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, values]) =>
    OWNED_KEYS.includes(key as (typeof OWNED_KEYS)[number]) && Array.isArray(values) && values.every((entry) => typeof entry === 'string'));
}

function legacyInstalled(key: (typeof OWNED_KEYS)[number], values: string[]): boolean {
  if (key === 'diff.tool' || key === 'merge.tool') return values.length === 1 && values[0] === 'forklift';
  if (key === 'mergetool.forklift.trustExitCode') return values.length === 1 && values[0] === 'true';
  return values.length === 1 && values[0]!.includes(key.startsWith('difftool.') ? '"difftool" "--local" "$LOCAL"' : '"mergetool" "--base" "$BASE"');
}

/** Registers Forklift as the selected Git diff and merge tool, preserving values for uninstall. */
export class GitToolSetup {
  constructor(private readonly git: GitCli) {}

  async setup(cwd: string, scope: GitToolScope, executable: readonly string[], dryRun = false): Promise<GitConfigChange[]> {
    if (!executable.length || executable.some((part) => !part || part.includes('\0'))) throw new TypeError('an executable command is required');
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
    const record: BackupRecord = { original: backup, installed: Object.fromEntries(changes.map(({ key, values }) => [key, values])) };
    await this.replace(cwd, scopeArgs, BACKUP_KEY, [JSON.stringify(record)]);
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored[0]!);
    } catch {
      throw new Error('Forklift Git config backup is invalid; no settings were changed');
    }
    const record = parsed as Partial<BackupRecord> | null;
    const modern = record !== null && typeof record === 'object' && 'original' in record;
    const backup = modern ? record.original : parsed;
    const installed = modern ? record.installed : null;
    if (!validBackup(backup) || (modern && !validBackup(installed))) throw new Error('Forklift Git config backup is invalid; no settings were changed');
    const changes = await Promise.all(OWNED_KEYS.map(async (key) => {
      const current = await this.get(cwd, scopeArgs, key);
      const expected = installed?.[key];
      const owned = expected ? current.length === expected.length && current.every((value, index) => value === expected[index]) : legacyInstalled(key, current);
      return { key, values: backup[key] ?? [], skipped: !owned };
    }));
    if (dryRun) return changes;
    for (const change of changes) {
      if (change.skipped) continue;
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
