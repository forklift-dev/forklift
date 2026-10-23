import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { lfsAttributeLine, type LfsInfo } from '../../shared/lfs';
import type { GitCli } from './cli';
import type { RemoteRun, RemoteService } from './remote';
import { RepoQueue } from './repoQueue';

export class LfsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LfsError';
  }
}

export const LFS_MISSING = 'git-lfs is not installed. Install it from https://git-lfs.com (or your package manager), then run "git lfs install" once.';
const CHECK_EVERY_MS = 30_000;
const MAX_PATHS = 2000;

/** Patterns of .gitattributes lines that put files in LFS (`… filter=lfs …`). */
export function lfsPatterns(attributes: string): string[] {
  return attributes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && /(^|\s)filter=lfs(\s|$)/.test(line))
    .map((line) => line.split(/\s+/)[0]!.replace(/\[\[:space:\]\]/g, ' '));
}

/** Git LFS: whether git-lfs is there, which files are in LFS, track/untrack patterns, pull and fetch objects. */
export class LfsService {
  private checked: { at: number; version: string | null } | null = null;

  constructor(
    private readonly git: GitCli,
    private readonly remotes: Pick<RemoteService, 'networkCommand'>,
    private readonly queue = new RepoQueue(),
    private readonly now: () => number = Date.now,
  ) {}

  /** `git lfs version` (checked again every 30 s, so installing it is noticed). */
  async version(): Promise<string | null> {
    if (this.checked && this.now() - this.checked.at < CHECK_EVERY_MS) return this.checked.version;
    const result = await this.git.exec(['lfs', 'version'], { cwd: homedir(), readOnly: true, allowedExitCodes: [1, 128], timeoutMs: 10_000 }).catch(() => null);
    const version = result?.exitCode === 0 ? (/git-lfs\/(\S+)/.exec(result.stdout)?.[1] ?? result.stdout.trim()) : null;
    this.checked = { at: this.now(), version };
    return version;
  }

  async info(root: string, paths: unknown): Promise<LfsInfo> {
    if (!Array.isArray(paths) || paths.length > MAX_PATHS || paths.some((path) => typeof path !== 'string' || path.includes('\0'))) throw new TypeError(`paths must be a list of up to ${MAX_PATHS}`);
    const [installed, patterns] = await Promise.all([this.version(), this.patterns(root)]);
    let lfsPaths: string[] = [];
    if (patterns.length && paths.length) {
      // check-attr -z: "path\0attribute\0value\0" for each path.
      const { stdout } = await this.git.exec(['check-attr', '-z', '--stdin', 'filter'], { cwd: root, readOnly: true, input: `${paths.join('\0')}\0` });
      const fields = stdout.split('\0');
      for (let i = 0; i + 2 < fields.length; i += 3) if (fields[i + 2] === 'lfs') lfsPaths.push(fields[i]!);
      lfsPaths = [...new Set(lfsPaths)];
    }
    return { installed, patterns, paths: lfsPaths };
  }

  /** Adds `pattern` to .gitattributes as `git lfs track` does (the change is left for the user to commit). */
  async track(root: string, pattern: unknown): Promise<void> {
    const valid = this.pattern(pattern);
    await this.requireLfs();
    await this.queue.run(root, async () => {
      const text = await this.attributes(root);
      if (lfsPatterns(text).includes(valid)) return;
      await writeFile(join(root, '.gitattributes'), `${text}${text && !text.endsWith('\n') ? '\n' : ''}${lfsAttributeLine(valid)}\n`);
    });
  }

  /** Removes the LFS line of `pattern` from .gitattributes (files already in LFS stay there until re-added). */
  async untrack(root: string, pattern: unknown): Promise<void> {
    const valid = this.pattern(pattern);
    await this.queue.run(root, async () => {
      const text = await this.attributes(root);
      const kept = text.split(/(?<=\n)/).filter((line) => !(lfsPatterns(line).length && lfsPatterns(line)[0] === valid));
      if (kept.join('') === text) throw new LfsError(`${valid} is not tracked with LFS`);
      await writeFile(join(root, '.gitattributes'), kept.join(''));
    });
  }

  /** Downloads the LFS objects of the current checkout (`pull` also puts them in the working tree). */
  async download(root: string, checkout: boolean, run: RemoteRun): Promise<void> {
    await this.requireLfs();
    await this.queue.run(root, () => this.remotes.networkCommand(root, ['lfs', checkout ? 'pull' : 'fetch'], run));
  }

  private async patterns(root: string): Promise<string[]> {
    return lfsPatterns(await this.attributes(root));
  }

  private attributes(root: string): Promise<string> {
    return readFile(join(root, '.gitattributes'), 'utf8').catch(() => '');
  }

  private async requireLfs(): Promise<void> {
    this.checked = null;
    if (!(await this.version())) throw new LfsError(LFS_MISSING);
  }

  private pattern(pattern: unknown): string {
    if (typeof pattern !== 'string' || !pattern.trim() || pattern.length > 200 || /[\0\r\n]/.test(pattern) || /^[!#]/.test(pattern.trim())) {
      throw new LfsError('Enter a file pattern such as *.psd or assets/**');
    }
    return pattern.trim();
  }
}
