import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { maskCredentials } from '../../shared/log';
import { GitCli } from '../git/cli';
import { directRunner } from '../process/testing';
import { OperationLog } from './operationLog';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forklift-log-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('maskCredentials', () => {
  it('hides passwords in URLs only', () => {
    expect(maskCredentials('git clone https://ada:s3cret@example.com/x.git')).toBe('git clone https://ada:***@example.com/x.git');
    expect(maskCredentials('ssh://git@example.com/x')).toBe('ssh://git@example.com/x');
    expect(maskCredentials('no url: here')).toBe('no url: here');
  });
});

describe('OperationLog', () => {
  it('links git runs to the operation they ran in, with outcome and timing', async () => {
    const log = new OperationLog();
    const git = new GitCli(directRunner(), 'git', (run) => log.git(run));
    await log.operation('stash:push', dir, async () => {
      await git.exec(['status', '--porcelain'], { cwd: dir, readOnly: true });
      await git.exec(['config', 'test.key', 'value'], { cwd: dir });
    });
    await expect(
      log.operation('branch:delete', dir, () => git.exec(['branch', '-D', 'missing'], { cwd: dir })),
    ).rejects.toThrow();
    await git.exec(['rev-parse', '--git-dir'], { cwd: dir, readOnly: true });

    const { entries } = log.page();
    const [stash, status, config, del, branch, outside] = entries;
    expect(entries).toHaveLength(6);
    expect(stash).toMatchObject({ kind: 'operation', title: 'stash:push', repo: dir, status: 'ok', parent: null });
    expect(stash!.durationMs).toBeGreaterThanOrEqual(0);
    expect(status).toMatchObject({ kind: 'git', title: 'git status --porcelain', parent: stash!.id, readOnly: true, status: 'ok', exitCode: 0 });
    expect(status!.stdout).toBeUndefined();
    expect(config).toMatchObject({ title: 'git config test.key value', parent: stash!.id, readOnly: false, stdout: '', stderr: '' });
    expect(del).toMatchObject({ kind: 'operation', status: 'error' });
    expect(del!.error).toMatch(/branch -D missing/);
    expect(branch).toMatchObject({ parent: del!.id, status: 'error', exitCode: 1 });
    expect(branch!.stderr).toMatch(/not found/);
    expect(outside).toMatchObject({ parent: null, title: 'git rev-parse --git-dir' });

    expect(log.family(del!.id).map((e) => e.id)).toEqual([del!.id, branch!.id]);
    expect(log.page(config!.id).entries.map((e) => e.id)).toEqual([del!.id, branch!.id, outside!.id]);
    const text = log.text();
    expect(text).toMatch(/stash:push \[.*\] ok \d+ ms/);
    expect(text).toMatch(/ {2}git branch -D missing .* error \d+ ms exit 1\n {4}error: branch 'missing' not found/);
  });

  it('masks credentials and keeps the last entries only', async () => {
    const log = new OperationLog();
    log.git({ args: ['clone', 'https://ada:pw@host/x.git'], cwd: dir, readOnly: false, durationMs: 1, exitCode: 128, ok: false, stdout: '', stderr: 'fatal: https://ada:pw@host/x.git not found' });
    expect(log.page().entries[0]).toMatchObject({ title: 'git clone https://ada:***@host/x.git', stderr: 'fatal: https://ada:***@host/x.git not found' });
    for (let i = 0; i < 3100; i++) log.git({ args: ['status'], cwd: dir, readOnly: true, durationMs: 0, exitCode: 0, ok: true, stdout: '', stderr: '' });
    const page = log.page();
    expect(page.entries.length).toBeLessThanOrEqual(1000);
    expect(log.page(0, 5000).entries).toHaveLength(3000);
    expect(page.dropped).toBe(true);
    log.clear();
    expect(log.page()).toEqual({ entries: [], dropped: false });
  });

  it('tells when it changes', async () => {
    let changes = 0;
    const log = new OperationLog(() => changes++);
    await log.operation('x', null, async () => {});
    expect(changes).toBe(2); // started, finished
  });
});
