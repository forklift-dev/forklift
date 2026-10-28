import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { GitCli } from '../git/cli';
import { WorktreeService } from '../git/worktrees';
import { TaskWorkspaceService } from './taskWorkspaces';

let root: string;
let dataFile: string;
let worktreePath: string;
let service: TaskWorkspaceService;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env }).toString().trim();

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-task-workspace-')));
  dataFile = join(dirname(root), `${basename(root)}.json`);
  worktreePath = `${root}-task-one`;
  git('init', '-q', '--initial-branch=main');
  writeFileSync(join(root, 'README.md'), 'task workspace fixture\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  service = new TaskWorkspaceService(new WorktreeService(new GitCli(directRunner(env))), dataFile);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); rmSync(worktreePath, { recursive: true, force: true }); rmSync(dataFile, { force: true }); });

describe('TaskWorkspaceService', () => {
  it('creates a task worktree and persists its note separately from Git', async () => {
    const created = await service.create(root, { name: 'Fix parser', branch: 'task/fix-parser', path: worktreePath });
    expect(created).toMatchObject({ name: 'Fix parser', branch: 'task/fix-parser', path: worktreePath, note: '' });
    expect(await service.list(root)).toEqual([created]);
    await service.updateNote(root, created.id, 'Reproduce the issue first.');
    expect((await service.list(root))[0]?.note).toBe('Reproduce the issue first.');
    expect(git('branch', '--show-current')).toBe('main');
  });
});
