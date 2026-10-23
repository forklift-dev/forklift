import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitCli } from '../git/cli';
import { createGitService } from '../git/service';
import { directRunner } from '../process/testing';
import { HistoryService } from './service';

let root: string;
const env = { ...process.env, GIT_COMMITTER_NAME: 'C', GIT_COMMITTER_EMAIL: 'c@x', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const sh = (author: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, env: { ...env, GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@x` }, stdio: 'pipe' }).toString().trim();
const git = createGitService();
const history = new HistoryService(new GitCli(directRunner(env)));
const commit = (author: string, file: string, content: string, message: string) => {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, file), content);
  sh(author, 'add', '.');
  sh(author, 'commit', '-qm', message);
  return sh(author, 'rev-parse', 'HEAD');
};
let shas: Record<string, string>;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-search-')));
  sh('Ada', 'init', '-q', '--initial-branch=main');
  shas = {};
  shas['base'] = commit('Ada', 'README.md', 'hello\n', 'Initial import');
  shas['login'] = commit('Grace', 'src/auth/Login.ts', 'export const login = () => token;\n', 'Add login form');
  sh('Ada', 'switch', '-qc', 'feature');
  shas['feature'] = commit('Linus', 'src/feature.ts', 'const SECRET_FLAG = 1;\n', 'Feature work, fixes #12');
  sh('Ada', 'switch', '-q', 'main');
  shas['docs'] = commit('Ada', 'docs/guide.md', 'guide\n', 'Docs');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const NONE = { solo: [], hidden: [] };

describe('history search', () => {
  it('finds commits by message, author, sha, file and content as row indices', async () => {
    const { historyVersion } = await git.read(root);
    const { rows } = await history.page(root, historyVersion, 0, 50);
    const at = (indices: number[]) => indices.map((index) => rows[index]!.hash);
    expect(at((await history.search(root, historyVersion, NONE, { field: 'message', text: 'LOGIN' })).indices)).toEqual([shas['login']]);
    expect(at((await history.search(root, historyVersion, NONE, { field: 'author', text: 'linus' })).indices)).toEqual([shas['feature']]);
    expect(at((await history.search(root, historyVersion, NONE, { field: 'sha', text: shas['docs']!.slice(0, 8) })).indices)).toEqual([shas['docs']]);
    expect(at((await history.search(root, historyVersion, NONE, { field: 'file', text: 'login.ts' })).indices)).toEqual([shas['login']]);
    expect(at((await history.search(root, historyVersion, NONE, { field: 'content', text: 'SECRET_FLAG' })).indices)).toEqual([shas['feature']]);
    expect((await history.search(root, historyVersion, NONE, { field: 'message', text: '[(' })).indices).toEqual([]);
  });

  it('solo shows one branch; hiding a branch drops only its own commits', async () => {
    const { historyVersion } = await git.read(root);
    const solo = await history.page(root, historyVersion, 0, 50, { solo: ['refs/heads/feature'], hidden: [] });
    expect(solo.rows.map((r) => r.subject)).toEqual(['Feature work, fixes #12', 'Add login form', 'Initial import']);
    const hidden = await history.page(root, historyVersion, 0, 50, { solo: [], hidden: ['refs/heads/feature'] });
    expect(hidden.rows.map((r) => r.subject)).toEqual(['Docs', 'Add login form', 'Initial import']);
    // A search follows the same filter.
    expect((await history.search(root, historyVersion, { solo: [], hidden: ['refs/heads/feature'] }, { field: 'author', text: 'Linus' })).indices).toEqual([]);
  });

  it('locates a commit by sha, walking as far as needed', async () => {
    const { historyVersion } = await git.read(root);
    expect(await history.locate(root, historyVersion, NONE, shas['base']!)).toBe(3);
    expect(await history.locate(root, historyVersion, NONE, 'f'.repeat(40))).toBe(-1);
  });
});
