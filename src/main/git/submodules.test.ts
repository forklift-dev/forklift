import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { RemoteService, type RemoteProgress } from './remote';
import { SubmoduleService } from './submodules';

let dir: string;
let app: string;
let lib: string;
// Local paths as submodule URLs need protocol.file.allow (git 2.38.1+ refuses them by default).
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'A',
  GIT_AUTHOR_EMAIL: 'a@x',
  GIT_COMMITTER_NAME: 'A',
  GIT_COMMITTER_EMAIL: 'a@x',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'protocol.file.allow',
  GIT_CONFIG_VALUE_0: 'always',
};
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();
const git = new GitCli(directRunner(env));
const noAskpass = { session: () => ({ env: {}, dispose: () => {} }) };
const service = new SubmoduleService(git, new RemoteService(git, noAskpass));
const run = (progress: RemoteProgress[] = []) => ({ signal: new AbortController().signal, onProgress: (p: RemoteProgress) => progress.push(p) });

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-submodules-')));
  lib = join(dir, 'lib');
  app = join(dir, 'app');
  sh(dir, 'init', '-q', '--initial-branch=main', lib);
  writeFileSync(join(lib, 'lib.txt'), 'lib\n');
  sh(lib, 'add', '.');
  sh(lib, 'commit', '-qm', 'lib');
  sh(dir, 'init', '-q', '--initial-branch=main', app);
  writeFileSync(join(app, 'a.txt'), 'a\n');
  sh(app, 'add', '.');
  sh(app, 'commit', '-qm', 'app');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SubmoduleService', () => {
  it('lists nothing without .gitmodules', async () => {
    expect(await service.list(app)).toEqual([]);
  });

  it('adds a submodule, lists its state, and notices new commits and changes inside', async () => {
    await service.add(app, lib, 'libs/lib', run());
    sh(app, 'commit', '-qm', 'add lib');
    const libHead = sh(lib, 'rev-parse', 'HEAD');
    expect(await service.list(app)).toEqual([{ name: 'libs/lib', path: 'libs/lib', url: lib, state: 'current', recorded: libHead, checkedOut: libHead, dirty: false }]);

    const inside = join(app, 'libs', 'lib');
    writeFileSync(join(inside, 'more.txt'), 'more\n');
    sh(inside, 'add', '.');
    sh(inside, 'commit', '-qm', 'more');
    writeFileSync(join(inside, 'lib.txt'), 'edited\n');
    const [moved] = await service.list(app);
    expect(moved).toMatchObject({ state: 'moved', recorded: libHead, checkedOut: sh(inside, 'rev-parse', 'HEAD'), dirty: true });
  });

  it('initializes and updates submodules of a fresh clone, recursively', async () => {
    // lib gets a submodule of its own.
    const deep = join(dir, 'deep');
    sh(dir, 'init', '-q', '--initial-branch=main', deep);
    writeFileSync(join(deep, 'd.txt'), 'd\n');
    sh(deep, 'add', '.');
    sh(deep, 'commit', '-qm', 'deep');
    sh(lib, 'submodule', 'add', '-q', deep, 'deep');
    sh(lib, 'commit', '-qm', 'deep');
    await service.add(app, lib, 'lib', run());
    sh(app, 'commit', '-qm', 'add lib');

    const copy = join(dir, 'copy');
    sh(dir, 'clone', '-q', app, copy);
    expect((await service.list(copy))[0]).toMatchObject({ path: 'lib', state: 'uninitialized', checkedOut: null });
    await service.update(copy, null, true, run());
    expect((await service.list(copy))[0]).toMatchObject({ state: 'current' });
    expect(existsSync(join(copy, 'lib', 'deep', 'd.txt'))).toBe(true);
  });

  it('syncs URLs and removes a submodule completely', async () => {
    await service.add(app, lib, 'lib', run());
    sh(app, 'commit', '-qm', 'add lib');
    sh(app, 'config', '-f', '.gitmodules', 'submodule.lib.url', '../lib-moved');
    await service.sync(app);
    expect(sh(app, 'config', 'submodule.lib.url')).toMatch(/lib-moved$/);

    await service.remove(app, 'lib');
    expect(existsSync(join(app, 'lib'))).toBe(false);
    expect(existsSync(join(app, '.git', 'modules', 'lib'))).toBe(false);
    expect(sh(app, 'status', '--porcelain')).toContain('D  lib');
    await expect(service.remove(app, 'a.txt')).rejects.toThrow(/not a submodule/);
  });

  it('refuses paths outside the repository and occupied ones', async () => {
    await expect(service.add(app, lib, '../outside', run())).rejects.toThrow(/not a folder inside/);
    await expect(service.add(app, lib, '.git/x', run())).rejects.toThrow(/not a folder inside/);
    await expect(service.add(app, lib, 'a.txt', run())).rejects.toThrow(/already exists/);
    await expect(service.add(app, '--evil', 'x', run())).rejects.toThrow(/Enter the repository URL/);
  });
});

describe('submodules in the changes and diffs', () => {
  it('marks a moved submodule as a submodule change and diffs it like git', async () => {
    const { createGitService } = await import('./service');
    const reader = createGitService();
    await service.add(app, lib, 'lib', run());
    sh(app, 'commit', '-qm', 'add lib');
    const before = sh(join(app, 'lib'), 'rev-parse', 'HEAD');
    writeFileSync(join(app, 'lib', 'new.txt'), 'n\n');
    sh(join(app, 'lib'), 'add', '.');
    sh(join(app, 'lib'), 'commit', '-qm', 'new');
    const after = sh(join(app, 'lib'), 'rev-parse', 'HEAD');
    writeFileSync(join(app, 'lib', 'lib.txt'), 'dirty\n');

    const data = await reader.read(app);
    expect(data.changes).toEqual([{ path: 'lib', kind: 'modified', staged: false, unstaged: true, submodule: true }]);
    const diff = await reader.fileDiff(app, { kind: 'worktree', path: 'lib', staged: false });
    expect(diff.original.text).toBe(`Subproject commit ${before}\n`);
    expect(diff.modified.text).toBe(`Subproject commit ${after}-dirty\n`);

    sh(app, 'add', 'lib');
    const staged = await reader.fileDiff(app, { kind: 'worktree', path: 'lib', staged: true });
    expect(staged.modified.text).toBe(`Subproject commit ${after}\n`);
  });
});
