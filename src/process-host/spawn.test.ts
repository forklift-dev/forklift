import { describe, expect, it } from 'vitest';
import type { LaunchRequest, RunRequest } from '../shared/process';
import { launchProcess, runProcess } from './spawn';

// Tests run inside Electron with ELECTRON_RUN_AS_NODE, so process.execPath runs scripts as Node.
const node = process.execPath;
const env = { ...(process.env as Record<string, string>), ELECTRON_RUN_AS_NODE: '1' };
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

let nextId = 1;
function run(script: string, extra: Partial<RunRequest> = {}) {
  return runProcess({ type: 'run', id: nextId++, command: node, args: ['-e', script], env, streamOutput: false, ...extra });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('runProcess', () => {
  it('collects stdout, stderr and the exit code', async () => {
    const { result } = run(`process.stdout.write('out'); process.stderr.write('err'); process.exit(3)`);
    expect(await result).toMatchObject({ code: 3, signal: null, timedOut: false, truncated: false, cancelled: false });
    const { stdout, stderr } = await result;
    expect(text(stdout)).toBe('out');
    expect(text(stderr)).toBe('err');
  });

  it('writes input to stdin', async () => {
    const { result } = run(`process.stdin.pipe(process.stdout)`, { input: new TextEncoder().encode('ping ✓') });
    expect(text((await result).stdout)).toBe('ping ✓');
  });

  it('streams output chunks as they arrive', async () => {
    const chunks: string[] = [];
    const handle = runProcess(
      { type: 'run', id: nextId++, command: node, args: ['-e', `console.log('a'); setTimeout(() => console.log('b'), 50)`], env, streamOutput: true },
      (stream, chunk) => chunks.push(`${stream}:${text(chunk)}`),
    );
    await handle.result;
    expect(chunks.join('')).toBe('stdout:a\nstdout:b\n');
  });

  it('kills the process on timeout', async () => {
    const { result } = run(`setTimeout(() => {}, 60_000)`, { timeoutMs: 200 });
    const outcome = await result;
    expect(outcome.timedOut).toBe(true);
    expect(outcome.code === null || outcome.code !== 0).toBe(true);
    expect(outcome.durationMs).toBeLessThan(5000);
  });

  it('truncates output at the limit and stops the process', async () => {
    const { result } = run(`const s = 'x'.repeat(65536); setInterval(() => process.stdout.write(s), 1)`, {
      maxOutputBytes: 100_000,
    });
    const outcome = await result;
    expect(outcome.truncated).toBe(true);
    expect(outcome.stdout.length).toBe(100_000);
  });

  it.skipIf(process.platform === 'win32')('cancel kills the whole process tree', async () => {
    // The child prints the pid of a grandchild it started, then waits forever.
    const script = `
      const { spawn } = require('node:child_process');
      const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
      console.log(grandchild.pid);
      setTimeout(() => {}, 60000);`;
    let reportPid!: (pid: number) => void;
    const reportedPid = new Promise<number>((resolve) => (reportPid = resolve));
    const handle = runProcess(
      { type: 'run', id: nextId++, command: node, args: ['-e', script], env, streamOutput: true },
      (_stream, chunk) => reportPid(Number.parseInt(text(chunk), 10)),
    );
    const grandchildPid = await reportedPid;
    expect(isAlive(grandchildPid)).toBe(true);

    handle.cancel();
    const outcome = await handle.result;
    expect(outcome.cancelled).toBe(true);
    await sleep(200);
    expect(isAlive(grandchildPid)).toBe(false);
  });

  it('rejects with ENOENT for a missing executable', async () => {
    const { result } = runProcess({ type: 'run', id: nextId++, command: 'forklift-no-such-binary', args: [], env, streamOutput: false });
    await expect(result).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('launchProcess', () => {
  const launch = (script: string, wait: boolean) =>
    launchProcess({ type: 'launch', id: nextId++, command: node, args: ['-e', script], env, wait } satisfies LaunchRequest);

  it('waits for the exit code when asked', async () => {
    expect(await launch('process.exit(7)', true).result).toMatchObject({ code: 7, signal: null });
  });

  it('detaches without waiting, and the program keeps running', async () => {
    const { result } = launch('setTimeout(() => {}, 1500)', false);
    const { pid, code } = await result;
    expect(code).toBeNull();
    expect(pid).toBeGreaterThan(0);
    expect(isAlive(pid!)).toBe(true);
    process.kill(pid!);
  });
});
