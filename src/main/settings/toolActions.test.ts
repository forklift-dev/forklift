import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiffTools } from '../external/diffTools';
import { ExternalTools } from '../external/tools';
import { GitCli } from '../git/cli';
import type { GitService } from '../git/service';
import { directRunner } from '../process/testing';
import { createAppStore } from '../store';
import { SettingsFile } from './file';
import { SettingsService } from './service';
import { ToolActions } from './toolActions';

let dir: string;
let repo: string;
let globalConfig: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-tool-actions-')));
  repo = join(dir, 'repo');
  mkdirSync(join(dir, 'bin'));
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  globalConfig = join(dir, 'gitconfig');
  writeFileSync(globalConfig, '');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function setup() {
  const env = { PATH: `${join(dir, 'bin')}:${process.env['PATH']}`, HOME: dir, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' };
  const runner = directRunner(env);
  const store = createAppStore({ version: '0', platform: 'linux' }, { git: {} as GitService });
  const settings = new SettingsService({ store, file: new SettingsFile(join(dir, 'settings.json')), runner, isOpenRepo: (root) => root === repo });
  await settings.load();
  const git = new GitCli(runner);
  const tools = new ExternalTools({ runner, platform: 'linux', openPath: async () => '' });
  const actions = new ToolActions(git, tools, new DiffTools(git, runner), settings);
  const config = (...args: string[]) => execFileSync('git', ['config', ...args], { cwd: repo, env: { ...process.env, ...env } }).toString().trim();
  return { settings, actions, config };
}

describe.skipIf(process.platform === 'win32')('ToolActions', () => {
  it('reads and writes the commit identity per scope; empty removes it', async () => {
    const { actions, config } = await setup();
    await actions.setIdentity(null, { name: 'Ada Lovelace', email: 'ada@example.com' });
    await actions.setIdentity(repo, { name: 'Ada (work)', email: '' });
    expect(await actions.identity(null)).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(await actions.identity(repo)).toEqual({ name: 'Ada (work)', email: '' });
    expect(config('--global', 'user.name')).toBe('Ada Lovelace');
    await actions.setIdentity(repo, { name: '', email: '' });
    expect(await actions.identity(repo)).toEqual({ name: '', email: '' });
    await expect(actions.setIdentity(null, { name: 'a\nb', email: '' })).rejects.toThrow('single line');
    await expect(actions.setIdentity(null, { name: 'a', email: '<a@b>' })).rejects.toThrow('< or >');
  });

  it('writes the chosen tool to git config so git uses it too', async () => {
    const { settings, actions, config } = await setup();
    await expect(actions.writeGitConfig('diff', null)).rejects.toThrow('already comes from git config');
    await settings.update({ values: { 'tools.diff': { mode: 'tool', name: 'meld' } } });
    await actions.writeGitConfig('diff', null);
    expect(config('--global', 'diff.tool')).toBe('meld');

    await settings.update({ repo, values: { 'tools.merge': { mode: 'custom', command: 'cp', args: ['$REMOTE', '$MERGED'], trustExitCode: true } } });
    await actions.writeGitConfig('merge', repo);
    expect(config('--local', 'merge.tool')).toBe('forklift-custom');
    expect(config('--local', 'mergetool.forklift-custom.cmd')).toBe('"cp" "$REMOTE" "$MERGED"');
    expect(config('--local', 'mergetool.forklift-custom.trustExitCode')).toBe('true');
  });

  it('tests diff and merge tools on a throwaway repository', async () => {
    const { settings, actions } = await setup();
    const out = join(dir, 'diff.out');
    writeFileSync(join(dir, 'bin', 'fake-diff'), `#!/bin/sh\ncat "$1" "$2" > "${out}"\n`, { mode: 0o755 });
    await settings.update({ values: { 'tools.diff': { mode: 'custom', command: 'fake-diff', args: ['$LOCAL', '$REMOTE'], trustExitCode: false } } });
    expect(await actions.test('diff', null)).toBe('forklift-custom showed a sample change and was closed');
    expect(readFileSync(out, 'utf8')).toBe('line 1\nline 2\nline 3\nline 1\nline two (changed)\nline 3\n');

    await settings.update({ values: { 'tools.merge': { mode: 'custom', command: 'cp', args: ['$REMOTE', '$MERGED'], trustExitCode: true } } });
    expect(await actions.test('merge', null)).toMatch(/opened a sample conflict and was closed \(resolved\)/);
    await settings.update({ values: { 'tools.merge': { mode: 'custom', command: 'true', args: [], trustExitCode: false } } });
    expect(await actions.test('merge', null)).toMatch(/closed \(left unresolved\)/);
    // The throwaway repositories are gone.
    expect(execFileSync('sh', ['-c', `ls -d ${tmpdir()}/forklift-tool-test-* 2>/dev/null || true`]).toString().trim()).toBe('');
  });

  it('tests the editor with a sample file and reports a missing program', async () => {
    const { settings, actions } = await setup();
    const out = join(dir, 'editor.out');
    writeFileSync(join(dir, 'bin', 'my-editor'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${out}"\n`, { mode: 0o755 });
    await settings.update({ repo, values: { 'tools.editor': { mode: 'custom', command: 'my-editor', args: ['{file}', '{line}'] } } });
    expect(await actions.test('editor', repo)).toMatch(/Opened .*example\.txt with .*my-editor/);
    for (let i = 0; i < 100 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 20));
    expect(readFileSync(out, 'utf8')).toMatch(/forklift-tool-test\/example\.txt\n3\n/);
    rmSync(join(dir, 'bin', 'my-editor'));
    await expect(actions.test('editor', repo)).rejects.toThrow(/Editor command "my-editor" was not found/);
  });

  it('lists available git tools and the configured ones', async () => {
    const { actions, config } = await setup();
    config('--global', 'diff.tool', 'kdiff3');
    const detected = await actions.detect(repo);
    expect(detected.gitConfig).toEqual({ diff: 'kdiff3', merge: null });
    expect(detected.diffTools.every((tool) => !['vimdiff', 'nvimdiff', 'emerge'].includes(tool.name))).toBe(true);
    expect(Array.isArray(detected.editors)).toBe(true);
  });
});
