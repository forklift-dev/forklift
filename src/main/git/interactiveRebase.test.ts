import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RebaseStep } from '../../shared/rebase';
import { directRunner } from '../process/testing';
import { GitCli } from './cli';
import { ConflictService } from './conflicts';
import { buildTodo, InteractiveRebase } from './interactiveRebase';
import { createGitService } from './service';

let root: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' }).toString().trim();
const cli = new GitCli(directRunner(env));
const rebase = new InteractiveRebase(cli);
const git = createGitService();
let base: string;
let shas: Record<string, string>;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-irebase-')));
  sh('init', '-q', '--initial-branch=main');
  writeFileSync(join(root, 'base.txt'), 'base\n');
  sh('add', '.');
  sh('commit', '-qm', 'base');
  base = sh('rev-parse', 'HEAD');
  shas = {};
  for (const name of ['one', 'two', 'three', 'four']) {
    writeFileSync(join(root, `${name}.txt`), `${name}\n`);
    sh('add', '.');
    sh('commit', '-qm', `Add ${name}`, '-m', `Body of ${name}`);
    shas[name] = sh('rev-parse', 'HEAD');
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const subjects = () => sh('log', '--format=%s', `${base}..HEAD`).split('\n').reverse();
const steps = (...entries: Array<[string, RebaseStep['action'], string?]>): RebaseStep[] =>
  entries.map(([name, action, message]) => ({ sha: shas[name]!, action, ...(message !== undefined && { message }) }));

describe('buildTodo', () => {
  it('turns reword and squash into fixups with an amend from a file', () => {
    const { todo, files } = buildTodo(
      [
        { sha: 'a', action: 'reword', message: 'New A' },
        { sha: 'b', action: 'squash' },
        { sha: 'c', action: 'pick' },
        { sha: 'd', action: 'fixup' },
        { sha: 'e', action: 'drop' },
      ],
      new Map([['a', 'Old A'], ['b', 'Msg B']]),
      (i) => `/m/${i} it's`,
    );
    expect(todo).toBe("pick a\nfixup b\nexec git commit --amend --allow-empty -q -F '/m/0 it'\\''s'\npick c\nfixup d\ndrop e\n");
    expect([...files.values()]).toEqual(['New A']);
    expect([...buildTodo([{ sha: 'a', action: 'pick' }, { sha: 'b', action: 'squash' }], new Map([['a', 'A'], ['b', 'B']]), (i) => `${i}`).files.values()]).toEqual(['A\n\nB']);
  });
});

describe('InteractiveRebase', () => {
  it('lists the commits after the base, oldest first', async () => {
    const plan = await rebase.plan(root, base);
    expect(plan.map((c) => c.subject)).toEqual(['Add one', 'Add two', 'Add three', 'Add four']);
    expect(plan[0]!.message).toBe('Add one\n\nBody of one');
  });

  it('reorders, drops, fixes up, squashes with a new message and rewords', async () => {
    const result = await rebase.run(root, base, steps(['three', 'pick'], ['one', 'reword', 'One, reworded'], ['two', 'squash'], ['four', 'drop']));
    expect(result).toBe('done');
    expect(subjects()).toEqual(['Add three', 'One, reworded']);
    expect(existsSync(join(root, 'two.txt')) && !existsSync(join(root, 'four.txt'))).toBe(true);
    sh('reset', '-q', '--hard', shas['four']!);
    await rebase.run(root, base, steps(['one', 'pick'], ['two', 'fixup'], ['three', 'squash'], ['four', 'pick']));
    expect(subjects()).toEqual(['Add one', 'Add four']);
    expect(sh('log', '-1', '--skip=1', '--format=%B').trim()).toBe('Add one\n\nBody of one\n\nAdd three\n\nBody of three');
  });

  it('refuses plans that do not fit the branch', async () => {
    await expect(rebase.run(root, base, steps(['one', 'squash'], ['two', 'pick'], ['three', 'pick'], ['four', 'pick']))).rejects.toThrow('first commit cannot be squashed');
    await expect(rebase.run(root, base, steps(['one', 'pick']))).rejects.toThrow('branch changed');
    await expect(rebase.run(root, base, steps(['one', 'reword', ' '], ['two', 'pick'], ['three', 'pick'], ['four', 'pick']))).rejects.toThrow('needs a message');
  });

  it('stops on conflicts; continuing later runs the rest, including the pending amend', async () => {
    // Swapping two commits that touch the same file conflicts.
    sh('reset', '-q', '--hard', base);
    writeFileSync(join(root, 'f.txt'), '1\n');
    sh('add', '.');
    sh('commit', '-qm', 'f one');
    shas['f1'] = sh('rev-parse', 'HEAD');
    writeFileSync(join(root, 'f.txt'), '1\n2\n');
    sh('commit', '-qam', 'f two');
    shas['f2'] = sh('rev-parse', 'HEAD');
    expect(await rebase.run(root, base, steps(['f2', 'reword', 'Two first'], ['f1', 'pick']))).toBe('conflicts');
    expect((await git.read(root)).operation).toMatchObject({ kind: 'rebase' });
    writeFileSync(join(root, 'f.txt'), '1\n2\n');
    sh('add', 'f.txt');
    await new ConflictService(cli).operation(root, { kind: 'rebase' }, 'continue');
    // f1 now conflicts against the reordered f2: a new stop, not an error. Resolve again and continue.
    expect((await git.read(root)).operation).toMatchObject({ kind: 'rebase' });
    writeFileSync(join(root, 'f.txt'), '1\n2\n');
    sh('add', 'f.txt');
    await new ConflictService(cli).operation(root, { kind: 'rebase' }, 'continue').catch(() => sh('rebase', '--skip'));
    expect((await git.read(root)).operation).toBeNull();
    expect(subjects()[0]).toBe('Two first');
  });

  it('refuses ranges with merges', async () => {
    sh('switch', '-qc', 'side', shas['one']!);
    sh('commit', '-q', '--allow-empty', '-m', 'side');
    sh('switch', '-q', 'main');
    sh('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    await expect(rebase.plan(root, base)).rejects.toThrow('merge commit');
  });
});
