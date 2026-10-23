import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directRunner } from '../process/testing';
import { BranchService } from './branches';
import { GitCli } from './cli';
import { CommitOps } from './commitOps';
import { RepoQueue } from './repoQueue';
import { createGitService } from './service';
import { StagingService } from './staging';
import { StashService } from './stash';
import { UndoService } from './undo';
import { UndoRecorder } from './undoRecorder';

let root: string;
let saveDir: string;
const env = { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' }).toString().trim();
const write = (path: string, text: string) => writeFileSync(join(root, path), text);
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const cli = new GitCli(directRunner(env));
const queue = new RepoQueue();
const stashes = new StashService(cli, queue);
const branches = new BranchService(cli, queue, stashes);
const staging = new StagingService(cli, createGitService(), queue);
const ops = new CommitOps(cli, queue);
let undo: UndoService;
let recorder: UndoRecorder;
let labels: { undo: string | null; redo: string | null };

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-undo-')));
  saveDir = mkdtempSync(join(tmpdir(), 'forklift-undo-save-'));
  sh('init', '-q', '--initial-branch=main');
  write('f.txt', 'base\n');
  sh('add', '.');
  sh('commit', '-qm', 'base');
  undo = new UndoService({ git: cli, branches, staging, stashes, queue, saveDir, changed: (_root, l) => (labels = l) });
  recorder = new UndoRecorder(undo);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(saveDir, { recursive: true, force: true });
});

describe('undo and redo', () => {
  it('commit: undo keeps the changes staged; redo brings the commit back', async () => {
    write('f.txt', 'changed\n');
    sh('add', '.');
    const base = sh('rev-parse', 'HEAD');
    await recorder.commit(root, 'commit “change”', () => staging.commit(root, 'change\n', false));
    const committed = sh('rev-parse', 'HEAD');
    expect(labels).toEqual({ undo: 'commit “change”', redo: null });
    expect(await undo.undo(root)).toBe('commit “change”');
    expect(sh('rev-parse', 'HEAD')).toBe(base);
    expect(sh('diff', '--cached', '--name-only')).toBe('f.txt');
    expect(labels).toEqual({ undo: null, redo: 'commit “change”' });
    await undo.redo(root);
    expect(sh('rev-parse', 'HEAD')).toBe(committed);
  });

  it('checkout, branch create/rename/delete and tags', async () => {
    const sha = sh('rev-parse', 'HEAD');
    await recorder.createBranch(root, 'topic', sha, true, () => branches.create(root, 'topic', sha, true));
    expect(sh('rev-parse', '--abbrev-ref', 'HEAD')).toBe('topic');
    await undo.undo(root);
    expect(sh('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(sh('branch', '--list', 'topic')).toBe('');
    await undo.redo(root);
    expect(sh('rev-parse', '--abbrev-ref', 'HEAD')).toBe('topic');

    await recorder.checkout(root, { kind: 'branch', name: 'main' }, () => branches.checkout(root, { kind: 'branch', name: 'main' }));
    await undo.undo(root);
    expect(sh('rev-parse', '--abbrev-ref', 'HEAD')).toBe('topic');
    await undo.redo(root);

    await recorder.renameBranch(root, 'topic', 'renamed', () => branches.rename(root, 'topic', 'renamed'));
    await undo.undo(root);
    expect(sh('branch', '--format=%(refname:short)')).toBe('main\ntopic');

    await recorder.deleteBranch(root, 'topic', () => branches.delete(root, 'topic', true));
    await undo.undo(root);
    expect(sh('rev-parse', 'topic')).toBe(sha);

    await recorder.tag(root, 'v1', true, () => branches.createTag(root, 'v1', sha, 'Release'));
    const object = sh('rev-parse', 'refs/tags/v1');
    await recorder.tag(root, 'v1', false, () => branches.deleteTag(root, 'v1'));
    await undo.undo(root);
    expect(sh('rev-parse', 'refs/tags/v1')).toBe(object); // the same annotated tag object
    expect(sh('cat-file', '-t', 'v1')).toBe('tag');
    await undo.undo(root);
    expect(sh('tag')).toBe('');
  });

  it('reset hard: undo brings back the commits and the uncommitted changes', async () => {
    const base = sh('rev-parse', 'HEAD');
    write('g.txt', 'g\n');
    sh('add', '.');
    sh('commit', '-qm', 'second');
    const second = sh('rev-parse', 'HEAD');
    write('f.txt', 'uncommitted\n');
    await recorder.reset(root, 'hard', () => ops.reset(root, base, 'hard'));
    expect(read('f.txt')).toBe('base\n');
    expect(existsSync(join(root, 'g.txt'))).toBe(false);
    await undo.undo(root);
    expect(sh('rev-parse', 'HEAD')).toBe(second);
    expect(read('f.txt')).toBe('uncommitted\n');
    await undo.redo(root);
    expect(sh('rev-parse', 'HEAD')).toBe(base);
  });

  it('reset mixed: undo restores what was staged', async () => {
    write('g.txt', 'g\n');
    sh('add', '.');
    sh('commit', '-qm', 'second');
    write('f.txt', 'staged\n');
    sh('add', 'f.txt');
    await recorder.reset(root, 'mixed', () => ops.reset(root, sh('rev-parse', 'HEAD~1'), 'mixed'));
    expect(sh('diff', '--cached', '--name-only')).toBe('');
    await undo.undo(root);
    expect(sh('log', '-1', '--format=%s')).toBe('second');
    expect(sh('diff', '--cached', '--name-only')).toBe('f.txt');
  });

  it('discard: undo restores tracked edits and deleted untracked files', async () => {
    write('f.txt', 'my edit\n');
    write('new.txt', 'untracked\n');
    await recorder.discard(root, ['f.txt'], ['new.txt'], () => staging.discardFiles(root, ['f.txt'], ['new.txt']));
    expect(read('f.txt')).toBe('base\n');
    expect(existsSync(join(root, 'new.txt'))).toBe(false);
    expect(labels.undo).toBe('discard of 2 files');
    await undo.undo(root);
    expect(read('f.txt')).toBe('my edit\n');
    expect(read('new.txt')).toBe('untracked\n');
    await undo.redo(root);
    expect(read('f.txt')).toBe('base\n');
  });

  it('stash push is undone by popping; a dropped stash comes back', async () => {
    write('f.txt', 'stashed\n');
    await recorder.stashPush(root, () => stashes.push(root, { message: 'wip', includeUntracked: true, stagedOnly: false }));
    expect(read('f.txt')).toBe('base\n');
    await undo.undo(root);
    expect(read('f.txt')).toBe('stashed\n');
    expect(sh('stash', 'list')).toBe('');
    expect(labels.redo).toBeNull();

    const sha = (await stashes.push(root, { message: 'keep me', includeUntracked: false, stagedOnly: false }))!;
    await recorder.stashDrop(root, sha, 'On main: keep me', () => stashes.drop(root, sha));
    await undo.undo(root);
    expect(sh('stash', 'list')).toBe('stash@{0}: On main: keep me');
  });

  it('merge and cherry-pick are undone with reset --keep; conflicts end the history', async () => {
    sh('switch', '-qc', 'feature');
    write('g.txt', 'g\n');
    sh('add', '.');
    sh('commit', '-qm', 'feature');
    sh('switch', '-q', 'main');
    write('h.txt', 'h\n');
    sh('add', '.');
    sh('commit', '-qm', 'main');
    const before = sh('rev-parse', 'HEAD');
    await recorder.history(root, 'merge of feature', () => ops.merge(root, 'feature', 'no-ff', null));
    await undo.undo(root);
    expect(sh('rev-parse', 'HEAD')).toBe(before);

    write('f.txt', 'main edit\n');
    sh('commit', '-qam', 'edit f');
    sh('switch', '-q', 'feature');
    write('f.txt', 'feature edit\n');
    sh('commit', '-qam', 'edit f too');
    sh('switch', '-q', 'main');
    await recorder.history(root, 'cherry-pick', () => ops.cherryPick(root, sh('rev-parse', 'feature')));
    expect(labels).toEqual({ undo: null, redo: null });
  });

  it('refuses when the repository changed outside, and clears the history', async () => {
    write('f.txt', 'changed\n');
    sh('add', '.');
    await recorder.commit(root, 'commit', () => staging.commit(root, 'change\n', false));
    sh('commit', '-q', '--allow-empty', '-m', 'from a terminal');
    await expect(undo.undo(root)).rejects.toThrow('changed since then');
    expect(labels).toEqual({ undo: null, redo: null });
    expect(sh('log', '-1', '--format=%s')).toBe('from a terminal');
  });
});
