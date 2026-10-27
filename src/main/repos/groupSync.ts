import { basename } from 'node:path';
import type { RepoGroup, GroupSync, RepoGroupStatus } from '../../shared/state';
import { t } from '../../shared/i18n';
import type { RemoteService } from '../git/remote';
import type { GitCli } from '../git/cli';
import type { GitService } from '../git/service';
import type { NetworkOps } from './network';
import type { AppStore } from '../store';
import { groupSyncChanged } from '../store';
import { loadRepo } from '../store/reposSlice';

/** Runs a group's repositories one at a time, so each result and cancellation has an unambiguous owner. */
export class GroupSyncRunner {
  private current: { groupId: string; root: string | null; cancelled: boolean } | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly git: GitService,
    private readonly cli: GitCli,
    private readonly remotes: RemoteService,
    private readonly network: NetworkOps,
  ) {}

  cancel(): void {
    if (!this.current) return;
    this.current.cancelled = true;
    if (this.current.root) this.network.cancel(this.current.root);
  }

  async run(group: RepoGroup, mode: 'fetch' | 'pull'): Promise<void> {
    if (this.current) throw new Error(t('A repository group update is already running'));
    const current = { groupId: group.id, root: null as string | null, cancelled: false };
    this.current = current;
    const activity: GroupSync = {
      groupId: group.id,
      mode,
      done: false,
      repos: group.repos.map((path) => ({ path, name: basename(path), status: 'waiting', message: t('Waiting') })),
    };
    const publish = () => this.store.dispatch(groupSyncChanged({ ...activity, repos: activity.repos.map((repo) => ({ ...repo })) }));
    publish();
    try {
      for (let index = 0; index < group.repos.length; index++) {
        const result = activity.repos[index]!;
        if (current.cancelled) {
          result.status = 'skipped';
          result.message = t('Cancelled');
          continue;
        }
        result.status = 'running';
        result.message = t('Updating…');
        publish();
        try {
          const root = await this.git.resolveRoot(result.path);
          if (root !== result.path) throw new Error(t('The path is not a repository root'));
          current.root = root;
          if (current.cancelled) throw new Error(t('Cancelled'));
          let skippedPull: string | null = null;
          const output = await this.network.run(root, mode === 'pull' ? 'pull' : 'fetch', async (run) => {
            await this.remotes.fetch(root, null, false, run);
            if (mode !== 'pull') return '';
            if ((await this.cli.exec(['status', '--porcelain', '--untracked-files=normal'], { cwd: root, readOnly: true })).stdout.trim()) {
              skippedPull = t('Skipped pull because the working tree has changes');
              return '';
            }
            if (!(await this.cli.exec(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, readOnly: true, allowedExitCodes: [1] })).stdout.trim()) {
              skippedPull = t('Skipped pull because HEAD is detached');
              return '';
            }
            const upstream = await this.cli.exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd: root, readOnly: true, allowedExitCodes: [128] });
            if (!upstream.stdout.trim()) {
              skippedPull = t('Skipped pull because the branch has no upstream');
              return '';
            }
            const merge = await this.cli.exec(['merge', '--ff-only', '--no-edit', upstream.stdout.trim()], { cwd: root, signal: run.signal });
            return merge.stdout;
          });
          if (current.cancelled) throw new Error(t('Cancelled'));
          if (skippedPull) {
            result.status = 'skipped';
            result.message = skippedPull;
          } else if (mode === 'pull') {
            result.status = /already up to date/i.test(output) ? 'up-to-date' : 'ok';
            result.message = result.status === 'up-to-date' ? t('Already up to date') : t('Fast-forwarded');
          } else {
            result.status = 'ok';
            result.message = t('Fetched');
          }
          if (this.store.getState().repos.byId[root]) await this.store.dispatch(loadRepo(root));
        } catch (error) {
          if (current.cancelled) {
            result.status = 'skipped';
            result.message = t('Cancelled');
          } else {
            result.status = 'failed';
            result.message = error instanceof Error ? error.message : String(error);
          }
        } finally {
          current.root = null;
          publish();
        }
      }
      activity.done = true;
      publish();
    } finally {
      this.current = null;
    }
  }
}

/** Local-only status for a repository group; counts use the most recently fetched remote-tracking refs. */
export async function readGroupStatus(group: RepoGroup, git: GitService, cli: GitCli): Promise<RepoGroupStatus[]> {
  const result: RepoGroupStatus[] = [];
  for (const path of group.repos) {
    const row: RepoGroupStatus = { path, name: basename(path), branch: null, dirty: false, ahead: 0, behind: 0, error: null };
    try {
      const root = await git.resolveRoot(path);
      if (root !== path) throw new Error(t('The path is not a repository root'));
      const branch = await cli.exec(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, readOnly: true, allowedExitCodes: [1] });
      row.branch = branch.stdout.trim() || null;
      row.dirty = Boolean((await cli.exec(['status', '--porcelain', '--untracked-files=normal'], { cwd: root, readOnly: true })).stdout.trim());
      if (row.branch) {
        const upstream = await cli.exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd: root, readOnly: true, allowedExitCodes: [128] });
        if (upstream.stdout.trim()) {
          const counts = (await cli.exec(['rev-list', '--left-right', '--count', `HEAD...${upstream.stdout.trim()}`], { cwd: root, readOnly: true })).stdout.trim().split(/\s+/).map(Number);
          row.ahead = counts[0] ?? 0;
          row.behind = counts[1] ?? 0;
        }
      }
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
    }
    result.push(row);
  }
  return result;
}
