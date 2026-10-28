import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { RepositoryHealthService } from './repositoryHealth';

let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env }).toString().trim();
const service = new RepositoryHealthService(new GitCli(directRunner(env)));

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-health-')));
  git('init', '-q', '--initial-branch=main');
  writeFileSync(join(root, 'large.bin'), Buffer.alloc(10 * 1024 * 1024 + 1, 65));
  git('add', '.');
  git('commit', '-qm', 'large file');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('RepositoryHealthService', () => {
  it('reports object-store stats and large tracked files without writing to the repository', async () => {
    const report = await service.scan(root);
    expect(report.healthy).toBe(true);
    expect(report.objectStore.loose).toBeGreaterThan(0);
    expect(report.largeFiles).toContainEqual({ path: 'large.bin', size: 10 * 1024 * 1024 + 1 });
    expect(git('status', '--porcelain')).toBe('');
  });
});
