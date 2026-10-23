import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { folderNameProblem, type CloneRequest, type CreateDefaults, type InitRequest } from '../../shared/repos';
import { GitCliError, type GitCli } from '../git/cli';
import type { RemoteRun, RemoteService } from '../git/remote';
import { gitignoreText, GITIGNORE_TEMPLATES, LICENSE_TEMPLATES, licenseText } from './templates';

export class CreateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateError';
  }
}

export interface InitResult {
  root: string;
  /** Set when the repository exists but something after `git init` did not work. */
  warning: string | null;
}

type FolderState = 'missing' | 'empty' | 'files' | 'repository';

async function folderState(path: string): Promise<FolderState> {
  const info = await stat(path).catch(() => null);
  if (!info) return 'missing';
  if (!info.isDirectory()) throw new CreateError(`${path} exists and is not a folder`);
  const entries = await readdir(path);
  if (entries.includes('.git')) return 'repository';
  return entries.length ? 'files' : 'empty';
}

async function assertParent(parent: unknown): Promise<string> {
  if (typeof parent !== 'string' || !isAbsolute(parent)) throw new CreateError('Choose the folder to create the repository in');
  const info = await stat(parent).catch(() => null);
  if (!info?.isDirectory()) throw new CreateError(`${parent} is not an existing folder`);
  return parent;
}

function assertName(name: unknown): string {
  const problem = typeof name === 'string' ? folderNameProblem(name) : 'Enter a folder name';
  if (problem) throw new CreateError(problem);
  return name as string;
}

/** New repositories: clones (through RemoteService, for progress and credentials) and `git init` with starter files. */
export class RepoCreator {
  constructor(
    private readonly git: GitCli,
    private readonly remotes: Pick<RemoteService, 'clone'>,
    /** Folder the dialogs start in (the setting, or the home folder). */
    private readonly defaultParent: () => string,
  ) {}

  async defaults(): Promise<CreateDefaults> {
    const config = async (key: string) =>
      (await this.git.exec(['config', '--get', key], { cwd: homedir(), readOnly: true, allowedExitCodes: [1] }).catch(() => null))?.stdout.trim() ?? '';
    const [branch, holder] = await Promise.all([config('init.defaultBranch'), config('user.name')]);
    return {
      parent: this.defaultParent() || homedir(),
      branch: branch || 'main',
      holder,
      gitignore: Object.entries(GITIGNORE_TEMPLATES).map(([key, { label }]) => ({ key, label })),
      licenses: Object.entries(LICENSE_TEMPLATES).map(([key, { label }]) => ({ key, label })),
    };
  }

  /** Why the dialog's folder can't be used (shown while typing), or null. */
  async targetProblem(kind: 'clone' | 'init', parent: unknown, name: unknown): Promise<string | null> {
    try {
      if (kind === 'clone') await this.cloneTarget(parent, name);
      else if ((await folderState(join(await assertParent(parent), assertName(name)))) === 'repository') return 'This folder is already a git repository';
      return null;
    } catch (error) {
      if (error instanceof CreateError) return error.message;
      throw error;
    }
  }

  /** Checks where a clone would go; resolves to the target folder. */
  async cloneTarget(parent: unknown, name: unknown): Promise<string> {
    const target = join(await assertParent(parent), assertName(name));
    const state = await folderState(target);
    if (state !== 'missing' && state !== 'empty') throw new CreateError(`${target} already exists and is not empty`);
    return target;
  }

  /** Resolves to the new repository's root. Nothing is left behind when it fails or is cancelled. */
  async clone(request: CloneRequest, run: RemoteRun): Promise<string> {
    const target = await this.cloneTarget(request.parent, request.name);
    const existed = (await folderState(target)) === 'empty';
    try {
      await this.remotes.clone(request.parent, request.url, target, run);
    } catch (error) {
      // A killed git cannot clean up; an empty folder the user chose stays (emptied).
      if (existed) for (const entry of await readdir(target).catch(() => [])) await rm(join(target, entry), { recursive: true, force: true });
      else await rm(target, { recursive: true, force: true });
      throw error;
    }
    return target;
  }

  /**
   * `git init` in a new or existing folder (not in a repository), then the chosen .gitignore and LICENSE
   * (an existing file of that name is kept) and optionally a first commit of just those files.
   */
  async init(request: InitRequest): Promise<InitResult> {
    const target = join(await assertParent(request.parent), assertName(request.name));
    if ((await folderState(target)) === 'repository') throw new CreateError(`${target} is already a git repository`);
    const branch = await this.branchName(request.branch, target);
    const gitignore = parseKeys(request.gitignore);
    if (request.license !== null && !(typeof request.license === 'string' && Object.hasOwn(LICENSE_TEMPLATES, request.license))) {
      throw new CreateError('Unknown license');
    }
    if (typeof request.holder !== 'string' || request.holder.length > 200 || /[\0\r\n]/.test(request.holder)) throw new CreateError('Enter the copyright holder on one line');

    await mkdir(target, { recursive: true });
    await this.git.exec(['init', `--initial-branch=${branch}`], { cwd: target });

    const written: string[] = [];
    const skipped: string[] = [];
    const add = async (file: string, text: string | null) => {
      if (!text) return;
      try {
        await writeFile(join(target, file), text, { flag: 'wx' });
        written.push(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        skipped.push(file);
      }
    };
    await add('.gitignore', gitignore.length ? gitignoreText(gitignore) : null);
    await add('LICENSE', request.license && licenseText(request.license, request.holder.trim()));

    const warnings = skipped.map((file) => `${file} already existed and was kept`);
    if (request.initialCommit) {
      try {
        if (written.length) await this.git.exec(['add', '--', ...written], { cwd: target });
        await this.git.exec(['commit', '--no-verify', ...(written.length ? [] : ['--allow-empty']), '-m', 'Initial commit', '--', ...written], { cwd: target });
      } catch (error) {
        if (!(error instanceof GitCliError)) throw error;
        warnings.push(`The first commit was not made: ${error.stderr.trim().split('\n').slice(-3).join(' ') || error.message}`);
      }
    }
    return { root: target, warning: warnings.length ? `${target}: ${warnings.join('; ')}` : null };
  }

  private async branchName(branch: unknown, cwd: string): Promise<string> {
    if (typeof branch !== 'string' || !branch || branch.startsWith('-') || branch.length > 255) throw new CreateError('Enter a branch name');
    const { exitCode } = await this.git.exec(['check-ref-format', '--branch', branch], { cwd: dirname(cwd), readOnly: true, allowedExitCodes: [1, 128] });
    if (exitCode !== 0) throw new CreateError(`"${branch}" is not a valid branch name`);
    return branch;
  }
}

function parseKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > Object.keys(GITIGNORE_TEMPLATES).length) throw new CreateError('Unknown .gitignore template');
  for (const key of value) if (typeof key !== 'string' || !Object.hasOwn(GITIGNORE_TEMPLATES, key)) throw new CreateError('Unknown .gitignore template');
  return [...new Set(value as string[])];
}
