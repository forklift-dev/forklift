import { join } from 'node:path';
import { Ignore, Repository } from '@axosoft/nodegit';
import nsfw from 'nsfw';
import { classifyPath } from './paths';

/** More changed working-tree paths than this are not checked against .gitignore one by one. */
const MAX_IGNORE_CHECKS = 200;

export interface WatcherEvents {
  /** Something that may change the repository state happened (debounced by the caller). */
  changed(): void;
  /** Watching failed (e.g. the inotify limit on Linux); the app falls back to refreshing on focus. */
  failed(error: Error): void;
}

/** Watches one repository's working tree and git directory with nsfw (native, recursive). */
export class RepoWatcher {
  private watchers: nsfw.NSFW[] = [];
  private stopped = false;

  private constructor(
    private readonly repo: Repository,
    private readonly root: string,
    private readonly gitDir: string,
    private readonly events: WatcherEvents,
  ) {}

  static async start(root: string, events: WatcherEvents): Promise<RepoWatcher> {
    const repo = await Repository.open(root);
    const gitDir = repo.path().replace(/[\\/]+$/, '');
    const watcher = new RepoWatcher(repo, root, gitDir, events);
    await watcher.watch(root);
    // A linked worktree or a separate git dir lives outside the working tree.
    if (!gitDir.startsWith(join(root, '.git'))) await watcher.watch(gitDir);
    return watcher;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const watchers = this.watchers.splice(0);
    await Promise.all(watchers.map((watcher) => watcher.stop().catch(() => {})));
  }

  private async watch(path: string): Promise<void> {
    const watcher = await nsfw(path, (events) => void this.onEvents(events), {
      debounceMS: 100,
      // Object files churn during fetch and gc and never change what is shown.
      excludedPaths: [join(this.gitDir, 'objects')],
      errorCallback: (error: unknown) => this.events.failed(error instanceof Error ? error : new Error(String(error))),
    });
    await watcher.start();
    if (this.stopped) await watcher.stop();
    else this.watchers.push(watcher);
  }

  private async onEvents(events: nsfw.FileChangeEvent[]): Promise<void> {
    if (this.stopped) return;
    const worktreePaths = new Set<string>();
    for (const event of events) {
      // Renames carry both names (nsfw's action values are a const enum, so check the shape).
      const paths =
        'oldFile' in event
          ? [join(event.directory, event.oldFile), join(event.newDirectory, event.newFile)]
          : [join(event.directory, event.file)];
      for (const path of paths) {
        const change = classifyPath(path, this.root, this.gitDir);
        if (change.kind === 'git') return this.events.changed();
        if (change.kind === 'worktree') worktreePaths.add(change.path);
      }
    }
    if (worktreePaths.size === 0) return;
    if (worktreePaths.size > MAX_IGNORE_CHECKS) return this.events.changed();
    // Build output and other ignored files change all the time without changing the status.
    for (const path of worktreePaths) {
      const ignored = await Ignore.pathIsIgnored(this.repo, path).catch(() => 0);
      if (!ignored) return this.events.changed();
    }
  }
}
