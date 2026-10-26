import { access, rm } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import type { SubmoduleInfo } from '../../shared/submodules';
import { normalizeRepoRelative } from '../repoPaths';
import { t } from '../../shared/i18n';
import type { GitCli } from './cli';
import type { RemoteRun, RemoteService } from './remote';
import { RepoQueue } from './repoQueue';

export class SubmoduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmoduleError';
  }
}

const exists = (path: string) => access(path).then(() => true, () => false);

/** Submodules through the git CLI: list with state, add, init/update (recursive), sync, remove. */
export class SubmoduleService {
  constructor(
    private readonly git: GitCli,
    private readonly remotes: Pick<RemoteService, 'networkCommand'>,
    private readonly queue = new RepoQueue(),
  ) {}

  async list(root: string): Promise<SubmoduleInfo[]> {
    if (!(await exists(join(root, '.gitmodules')))) return [];
    const read = (args: string[], allowed: number[] = []) => this.git.exec(args, { cwd: root, readOnly: true, allowedExitCodes: allowed }).then((r) => r.stdout);
    const config = await read(['config', '-f', '.gitmodules', '-z', '--get-regexp', '^submodule\\..*\\.(path|url)$'], [1]);
    const byName = new Map<string, { path: string; url: string }>();
    for (const item of config.split('\0').filter(Boolean)) {
      const newline = item.indexOf('\n');
      const match = /^submodule\.(.+)\.(path|url)$/.exec(item.slice(0, newline));
      if (!match) continue;
      const entry = byName.get(match[1]!) ?? { path: '', url: '' };
      entry[match[2] as 'path' | 'url'] = item.slice(newline + 1);
      byName.set(match[1]!, entry);
    }

    // " <sha> path (describe)": '-' not initialized, '+' at another commit, 'U' conflict.
    const status = new Map<string, { mark: string; sha: string }>();
    for (const line of (await read(['submodule', 'status'], [1])).split('\n')) {
      const match = /^([ +\-U])([0-9a-f]{40,64}) (.+?)(?: \(.*\))?$/.exec(line);
      if (match) status.set(match[3]!, { mark: match[1]!, sha: match[2]! });
    }
    // Porcelain v2 marks submodules "S<commit><modified><untracked>".
    const dirty = new Set<string>();
    const recorded = new Map<string, string>();
    for (const line of (await read(['status', '--porcelain=v2', '-z', '--ignore-submodules=none'])).split('\0')) {
      const fields = line.split(' ');
      if (fields[0] === '1' && fields[2]?.startsWith('S')) {
        const path = fields.slice(8).join(' ');
        if (fields[2][2] === 'M' || fields[2][3] === 'U') dirty.add(path);
      }
    }
    for (const line of (await read(['ls-files', '-s', '-z'])).split('\0')) {
      const match = /^160000 ([0-9a-f]+) 0\t(.+)$/.exec(line);
      if (match) recorded.set(match[2]!, match[1]!);
    }

    return [...byName].map(([name, { path, url }]) => {
      const entry = status.get(path);
      const state: SubmoduleInfo['state'] = !entry || entry.mark === '-' ? 'uninitialized' : entry.mark === 'U' ? 'conflict' : entry.mark === '+' ? 'moved' : 'current';
      return { name, path, url, state, recorded: recorded.get(path) ?? null, checkedOut: state === 'uninitialized' ? null : (entry?.sha ?? null), dirty: dirty.has(path) };
    });
  }

  /** `git submodule add`: clones `url` into `path` and records it (staged, to be committed). */
  async add(root: string, url: unknown, path: unknown, run: RemoteRun): Promise<void> {
    if (typeof url !== 'string' || !url.trim() || url.trim().startsWith('-') || /[\0\r\n]/.test(url) || url.length > 4096) throw new SubmoduleError(t('Enter the repository URL'));
    const target = this.relativePath(path);
    return this.queue.run(root, async () => {
      if (await exists(join(root, target))) throw new SubmoduleError(t('{path} already exists', { path: target }));
      await this.remotes.networkCommand(root, ['submodule', 'add', '--progress', '--', url.trim(), target], run);
    });
  }

  /** `git submodule update --init` (recursive by default) for `paths`, or all when null. */
  async update(root: string, paths: string[] | null, recursive: boolean, run: RemoteRun): Promise<void> {
    const list = paths?.map((path) => this.relativePath(path)) ?? [];
    return this.queue.run(root, async () => {
      await this.remotes.networkCommand(root, ['submodule', 'update', '--init', '--progress', ...(recursive ? ['--recursive'] : []), '--', ...list], run);
    });
  }

  /** Checks submodules out at the commits the repository records (no fetching; changes inside them stay). */
  async restore(root: string, paths: string[]): Promise<void> {
    const list = paths.map((path) => this.relativePath(path));
    return this.queue.run(root, async () => {
      await this.git.exec(['submodule', 'update', '--init', '--no-fetch', '--', ...list], { cwd: root });
    });
  }

  /** Copies URLs from .gitmodules into the configuration (after a URL changed upstream). */
  sync(root: string): Promise<void> {
    return this.queue.run(root, async () => {
      await this.git.exec(['submodule', 'sync', '--recursive'], { cwd: root });
    });
  }

  /** Removes a submodule: deinit, `git rm` (gitlink and .gitmodules entry, staged), and its clone in .git/modules. */
  async remove(root: string, path: unknown): Promise<void> {
    const target = this.relativePath(path);
    return this.queue.run(root, async () => {
      const found = (await this.list(root)).find((submodule) => submodule.path === target);
      if (!found) throw new SubmoduleError(t('{path} is not a submodule', { path: target }));
      await this.git.exec(['submodule', 'deinit', '-f', '--', target], { cwd: root });
      // git rm edits .gitmodules and refuses while it has unstaged edits.
      await this.git.exec(['add', '--', '.gitmodules'], { cwd: root });
      await this.git.exec(['rm', '-f', '--', target], { cwd: root });
      const gitDir = (await this.git.exec(['rev-parse', '--absolute-git-dir'], { cwd: root, readOnly: true })).stdout.trim();
      const modules = join(gitDir, 'modules');
      const clone = normalize(join(modules, found.name));
      // Only ever inside .git/modules.
      if (relative(modules, clone).startsWith('..') || isAbsolute(relative(modules, clone)) || !clone.startsWith(modules + sep)) return;
      await rm(clone, { recursive: true, force: true });
    });
  }

  private relativePath(path: unknown): string {
    if (typeof path !== 'string' || !path.trim()) throw new SubmoduleError(t('Enter the folder for the submodule'));
    try {
      const relativePath = normalizeRepoRelative(path.trim().replace(/\\/g, '/').replace(/\/+$/, ''));
      if (relativePath === '.git' || relativePath.startsWith('.git/')) throw new Error('inside .git');
      return relativePath;
    } catch {
      throw new SubmoduleError(t('"{path}" is not a folder inside the repository', { path: String(path) }));
    }
  }
}
