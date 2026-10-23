import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { listFiles } from './files';

let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-files-')));
  sh('init', '-q');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('lists tracked and untracked files, not ignored ones, with odd names intact', async () => {
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), '');
  writeFileSync(join(root, '.gitignore'), 'build/\n');
  sh('add', '.');
  sh('commit', '-qm', 'base');
  writeFileSync(join(root, 'new file "quoted".txt'), '');
  writeFileSync(join(root, 'ünïcode.md'), '');
  mkdirSync(join(root, 'build'));
  writeFileSync(join(root, 'build', 'out.js'), '');
  const { paths, truncated } = await listFiles(new GitCli(directRunner(env)), root);
  expect(paths.sort()).toEqual(['.gitignore', 'new file "quoted".txt', 'src/a.ts', 'ünïcode.md']);
  expect(truncated).toBe(false);
});
