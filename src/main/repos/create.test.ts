import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { folderNameProblem, repoNameFromUrl, type InitRequest } from '../../shared/repos';
import { GitCli } from '../git/cli';
import { RemoteService, type RemoteProgress, type RemoteRun } from '../git/remote';
import { directRunner } from '../process/testing';
import { RepoCreator } from './create';
import { gitignoreText, licenseText } from './templates';

let dir: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();
const cli = new GitCli(directRunner(env));
const noAskpass = { session: () => ({ env: {}, dispose: () => {} }) };
const creator = new RepoCreator(cli, new RemoteService(cli, noAskpass), () => '');
const run = (progress: RemoteProgress[] = [], signal = new AbortController().signal): RemoteRun => ({ signal, onProgress: (p) => progress.push(p) });
const initRequest = (change: Partial<InitRequest> = {}): InitRequest => ({ parent: dir, name: 'fresh', branch: 'trunk', gitignore: [], license: null, holder: '', initialCommit: false, ...change });

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-create-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('names', () => {
  it('derives the folder name from the URL like git', () => {
    expect(repoNameFromUrl('https://example.com/team/app.git')).toBe('app');
    expect(repoNameFromUrl('git@example.com:team/app.git/')).toBe('app');
    expect(repoNameFromUrl('ssh://host/app')).toBe('app');
    expect(repoNameFromUrl('/srv/git/lib.git')).toBe('lib');
    expect(repoNameFromUrl('C:\\repos\\tool')).toBe('tool');
    expect(repoNameFromUrl('')).toBe('');
  });

  it('rejects folder names no system accepts', () => {
    expect(folderNameProblem('app')).toBeNull();
    for (const bad of ['', '..', 'a/b', 'a\\b', 'x:', 'name.', 'name ', ' name', 'a*b']) expect(folderNameProblem(bad)).not.toBeNull();
  });
});

describe('templates', () => {
  it('combines .gitignore templates with headings', () => {
    const text = gitignoreText(['node', 'os', 'unknown']);
    expect(text).toMatch(/^# Node\.js\nnode_modules\//);
    expect(text).toContain('# macOS, Windows, Linux files\n.DS_Store');
    expect(text).not.toContain('unknown');
  });

  it('fills in the year and holder of a license', () => {
    expect(licenseText('MIT', 'Ada', 2026)).toMatch(/^MIT License\n\nCopyright \(c\) 2026 Ada\n/);
    expect(licenseText('BSD-3-Clause', '', 2026)).toContain('Copyright (c) 2026 the authors');
    expect(licenseText('GPL', 'Ada')).toBeNull();
  });
});

describe('clone', () => {
  let origin: string;
  beforeEach(() => {
    origin = join(dir, 'origin.git');
    const work = join(dir, 'work');
    sh(dir, 'init', '-q', '--bare', '--initial-branch=main', origin);
    sh(dir, 'clone', '-q', origin, work);
    for (let i = 0; i < 3; i++) writeFileSync(join(work, `f${i}.txt`), `${i}\n`.repeat(3000));
    sh(work, 'add', '.');
    sh(work, 'commit', '-qm', 'base');
    sh(work, 'push', '-q', 'origin', 'main');
  });

  it('clones a local bare repository with progress', async () => {
    const progress: RemoteProgress[] = [];
    // file:// goes through the pack protocol (a plain path copies files without progress).
    const root = await creator.clone({ url: `file://${origin}`, parent: dir, name: 'copy' }, run(progress));
    expect(root).toBe(join(dir, 'copy'));
    expect(sh(root, 'log', '--format=%s')).toBe('base');
    expect(sh(root, 'remote', 'get-url', 'origin')).toBe(`file://${origin}`);
    expect(progress.some((p) => p.percent === 100)).toBe(true);
  });

  it('clones into an empty existing folder and refuses one with files', async () => {
    mkdirSync(join(dir, 'empty'));
    await creator.clone({ url: origin, parent: dir, name: 'empty' }, run());
    expect(existsSync(join(dir, 'empty', 'f0.txt'))).toBe(true);
    await expect(creator.clone({ url: origin, parent: dir, name: 'empty' }, run())).rejects.toThrow(/already exists and is not empty/);
    expect(await creator.targetProblem('clone', dir, 'empty')).toMatch(/not empty/);
    expect(await creator.targetProblem('clone', dir, 'new')).toBeNull();
    expect(await creator.targetProblem('clone', join(dir, 'missing'), 'new')).toMatch(/not an existing folder/);
    expect(await creator.targetProblem('clone', 'relative', 'new')).toMatch(/Choose the folder/);
  });

  it('leaves nothing behind when the clone fails', async () => {
    await expect(creator.clone({ url: join(dir, 'nope.git'), parent: dir, name: 'copy' }, run())).rejects.toThrow(/does not exist|not appear to be a git repository/);
    expect(existsSync(join(dir, 'copy'))).toBe(false);
    await expect(creator.clone({ url: '--upload-pack=evil', parent: dir, name: 'copy' }, run())).rejects.toThrow(/Enter a repository URL/);
  });

  it('removes a cancelled clone (a killed git cannot clean up)', async () => {
    const hanging = {
      clone: (_parent: string, _url: string, target: string, { signal }: RemoteRun) => {
        mkdirSync(join(target, '.git'), { recursive: true });
        writeFileSync(join(target, '.git', 'partial'), 'x');
        return new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('killed'))));
      },
    };
    const cancelling = new RepoCreator(cli, hanging, () => '');
    let controller = new AbortController();
    let pending = cancelling.clone({ url: origin, parent: dir, name: 'copy' }, run([], controller.signal));
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await expect(pending).rejects.toThrow('killed');
    expect(existsSync(join(dir, 'copy'))).toBe(false);

    // A chosen empty folder stays, emptied.
    mkdirSync(join(dir, 'chosen'));
    controller = new AbortController();
    pending = cancelling.clone({ url: origin, parent: dir, name: 'chosen' }, run([], controller.signal));
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await expect(pending).rejects.toThrow('killed');
    expect(readdirSync(join(dir, 'chosen'))).toEqual([]);
  });
});

describe('init', () => {
  it('creates a repository with the chosen branch and starter files in a first commit', async () => {
    writeFileSync(join(dir, 'unrelated.txt'), 'x');
    const { root, warning } = await creator.init(initRequest({ gitignore: ['node', 'os'], license: 'MIT', holder: 'Ada Lovelace', initialCommit: true }));
    expect(root).toBe(join(dir, 'fresh'));
    expect(warning).toBeNull();
    expect(sh(root, 'symbolic-ref', '--short', 'HEAD')).toBe('trunk');
    expect(sh(root, 'log', '--format=%s')).toBe('Initial commit');
    expect(sh(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['.gitignore', 'LICENSE']);
    expect(readFileSync(join(root, 'LICENSE'), 'utf8')).toContain(`Copyright (c) ${new Date().getFullYear()} Ada Lovelace`);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('node_modules/');
  });

  it('commits only its own files in a folder with files, keeping an existing .gitignore', async () => {
    const folder = join(dir, 'existing');
    mkdirSync(folder);
    writeFileSync(join(folder, 'code.js'), 'x');
    writeFileSync(join(folder, '.gitignore'), 'mine\n');
    expect(await creator.targetProblem('init', dir, 'existing')).toBeNull();
    const { root, warning } = await creator.init(initRequest({ name: 'existing', gitignore: ['node'], license: 'ISC', initialCommit: true }));
    expect(warning).toMatch(/\.gitignore already existed and was kept/);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('mine\n');
    expect(sh(root, 'show', '--name-only', '--format=', 'HEAD')).toBe('LICENSE');
    expect(sh(root, 'status', '--porcelain')).toContain('?? code.js');
  });

  it('makes an empty first commit when there are no starter files, and none when not asked', async () => {
    const { root } = await creator.init(initRequest({ initialCommit: true }));
    expect(sh(root, 'log', '--format=%s')).toBe('Initial commit');
    const bare = await creator.init(initRequest({ name: 'nocommit' }));
    expect(() => sh(bare.root, 'rev-parse', 'HEAD')).toThrow();
  });

  it('refuses a repository, bad branch names and unknown templates', async () => {
    await creator.init(initRequest());
    await expect(creator.init(initRequest())).rejects.toThrow(/already a git repository/);
    expect(await creator.targetProblem('init', dir, 'fresh')).toMatch(/already a git repository/);
    await expect(creator.init(initRequest({ name: 'b', branch: 'bad..name' }))).rejects.toThrow(/not a valid branch name/);
    await expect(creator.init(initRequest({ name: 'b', branch: '-x' }))).rejects.toThrow(/Enter a branch name/);
    await expect(creator.init(initRequest({ name: 'b', gitignore: ['nope'] }))).rejects.toThrow(/Unknown \.gitignore/);
    await expect(creator.init(initRequest({ name: 'b', license: 'GPL-3.0' }))).rejects.toThrow(/Unknown license/);
    await expect(creator.init(initRequest({ name: '../escape' }))).rejects.toThrow(/not a valid folder name/);
    expect(existsSync(join(dir, 'b'))).toBe(false);
  });

  it('offers defaults from git config', async () => {
    const defaults = await creator.defaults();
    expect(defaults.branch).toBe('main');
    expect(defaults.gitignore.map((t) => t.key)).toContain('node');
    expect(defaults.licenses.map((t) => t.key)).toEqual(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Unlicense']);
  });
});
