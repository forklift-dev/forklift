import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flowBranch, type GitflowConfig } from '../../shared/gitflow';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { GitflowService } from './gitflow';

let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' }).toString().trim();
const flow = new GitflowService(new GitCli(directRunner(env)));
const CONFIG: GitflowConfig = { production: 'main', develop: 'develop', feature: 'feature/', release: 'release/', hotfix: 'hotfix/', versionTag: 'v' };
const commit = (file: string, text: string, message: string) => {
  writeFileSync(join(root, file), text);
  sh('add', '.');
  sh('commit', '-qm', message);
};
const parents = (ref: string) => sh('log', '-1', '--format=%P', ref).split(' ').length;
const contains = (branch: string, ref: string) => {
  try {
    sh('merge-base', '--is-ancestor', ref, branch);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-gitflow-')));
  sh('init', '-q', '--initial-branch=main');
  commit('a.txt', 'a\n', 'init');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('flowBranch', () => {
  it('recognizes flow branches by prefix', () => {
    expect(flowBranch(CONFIG, 'feature/login')).toEqual({ kind: 'feature', name: 'login' });
    expect(flowBranch(CONFIG, 'release/1.2')).toEqual({ kind: 'release', name: '1.2' });
    expect(flowBranch(CONFIG, 'feature/')).toBeNull();
    expect(flowBranch(CONFIG, 'main')).toBeNull();
  });
});

describe('GitflowService', () => {
  it('is not set up until initialized; init creates develop', async () => {
    expect(await flow.config(root)).toBeNull();
    expect(await flow.init(root, CONFIG)).toEqual(CONFIG);
    expect(await flow.config(root)).toEqual(CONFIG);
    expect(sh('rev-parse', 'develop')).toBe(sh('rev-parse', 'main'));
    await expect(flow.init(root, { ...CONFIG, production: 'nope' })).rejects.toThrow(/no branch nope/);
    await expect(flow.init(root, { ...CONFIG, develop: 'main' })).rejects.toThrow(/different branches/);
    await expect(flow.init(root, { ...CONFIG, feature: 'bad prefix' })).rejects.toThrow(/not valid/);
  });

  it('runs a feature: start from develop, finish merges --no-ff into develop and deletes it', async () => {
    await flow.init(root, CONFIG);
    expect(await flow.start(root, 'feature', 'login')).toBe('feature/login');
    expect(sh('symbolic-ref', '--short', 'HEAD')).toBe('feature/login');
    commit('login.txt', 'login\n', 'Login');
    await flow.finish(root, 'feature/login', { keepBranch: false });
    expect(sh('symbolic-ref', '--short', 'HEAD')).toBe('develop');
    expect(parents('develop')).toBe(2);
    expect(sh('log', '-1', '--format=%s', 'develop')).toBe("Merge branch 'feature/login' into develop");
    expect(sh('branch', '--list', 'feature/login')).toBe('');
    expect(contains('main', 'develop')).toBe(false);
  });

  it('runs a release: merged into production and develop, tagged, deleted', async () => {
    await flow.init(root, CONFIG);
    await flow.start(root, 'release', '1.0');
    commit('version.txt', '1.0\n', 'Bump to 1.0');
    await expect(flow.start(root, 'release', '1.1')).rejects.toThrow(/release\/1\.0 is not finished/);
    await flow.finish(root, 'release/1.0', { keepBranch: false, tagMessage: 'First release' });
    expect(sh('tag', '-n', '--list', 'v1.0')).toMatch(/^v1\.0\s+First release$/);
    expect(contains('main', 'v1.0')).toBe(true);
    expect(sh('rev-parse', 'v1.0^{commit}')).toBe(sh('rev-parse', 'main'));
    expect(contains('develop', 'main')).toBe(true);
    expect(sh('symbolic-ref', '--short', 'HEAD')).toBe('develop');
    expect(sh('branch', '--list', 'release/1.0')).toBe('');
  });

  it('runs a hotfix from production, and keeps the branch when asked', async () => {
    await flow.init(root, CONFIG);
    sh('checkout', '-q', 'develop');
    commit('dev.txt', 'dev\n', 'Develop work');
    await flow.start(root, 'hotfix', '1.0.1');
    expect(sh('rev-parse', 'HEAD')).toBe(sh('rev-parse', 'main'));
    commit('fix.txt', 'fix\n', 'Fix');
    await flow.finish(root, 'hotfix/1.0.1', { keepBranch: true });
    expect(sh('tag', '-n', '--list', 'v1.0.1')).toMatch(/Hotfix 1\.0\.1$/);
    expect(contains('develop', 'hotfix/1.0.1') && contains('main', 'hotfix/1.0.1')).toBe(true);
    expect(sh('log', '-1', '--format=%s', 'develop')).toBe("Merge tag 'v1.0.1' into develop");
    expect(contains('main', 'develop')).toBe(false);
    expect(sh('branch', '--list', 'hotfix/1.0.1')).toContain('hotfix/1.0.1');
  });

  it('stops on conflicts and finishes the rest when run again', async () => {
    await flow.init(root, CONFIG);
    await flow.start(root, 'feature', 'clash');
    commit('a.txt', 'feature side\n', 'Feature edit');
    sh('checkout', '-q', 'develop');
    commit('a.txt', 'develop side\n', 'Develop edit');
    await expect(flow.finish(root, 'feature/clash', { keepBranch: false })).rejects.toThrow(/stopped with conflicts/);
    writeFileSync(join(root, 'a.txt'), 'both\n');
    sh('add', '.');
    sh('commit', '-q', '--no-edit');
    await flow.finish(root, 'feature/clash', { keepBranch: false });
    expect(sh('branch', '--list', 'feature/clash')).toBe('');
    expect(sh('log', '-1', '--format=%s', 'develop')).toBe("Merge branch 'feature/clash' into develop");
  });

  it('refuses dirty trees, unknown branches and bad names', async () => {
    await expect(flow.start(root, 'feature', 'x')).rejects.toThrow(/not set up/);
    await flow.init(root, CONFIG);
    await flow.start(root, 'feature', 'x');
    writeFileSync(join(root, 'a.txt'), 'dirty\n');
    await expect(flow.finish(root, 'feature/x', { keepBranch: false })).rejects.toThrow(/Commit or stash/);
    await expect(flow.finish(root, 'main', { keepBranch: false })).rejects.toThrow(/Choose a feature/);
    await expect(flow.start(root, 'feature', 'x')).rejects.toThrow(/already exists/);
    await expect(flow.start(root, 'feature', 'a..b')).rejects.toThrow(/not a valid branch name/);
    await expect(flow.start(root, 'feature', '')).rejects.toThrow(/Enter a name/);
  });
});
