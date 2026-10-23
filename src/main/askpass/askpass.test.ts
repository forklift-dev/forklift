import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AskPrompt } from '../../shared/state';
import { runAskpassClient } from './client';
import { classifyPrompt } from './protocol';
import { AskpassServer } from './server';

let dir: string;
let server: AskpassServer;
let asked: AskPrompt[];
let answers: Array<string | null>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forklift-askpass-test-'));
  asked = [];
  answers = [];
});
afterEach(async () => {
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

async function start(command = { executable: '/bin/echo', args: [] as string[] }) {
  server = new AskpassServer({
    scriptDir: dir,
    command,
    ask: async (prompt) => {
      asked.push(prompt);
      return answers.shift() ?? null;
    },
  });
  await server.start();
}

describe('classifyPrompt', () => {
  it.each([
    ["Username for 'https://github.com': ", 'username'],
    ["Password for 'https://ada@github.com': ", 'password'],
    ["Enter passphrase for key '/home/ada/.ssh/id_ed25519': ", 'passphrase'],
    ['Are you sure you want to continue connecting (yes/no/[fingerprint])? ', 'confirm'],
    ['Something else: ', 'other'],
  ])('%s → %s', (prompt, kind) => {
    expect(classifyPrompt(prompt)).toBe(kind);
  });
});

describe.skipIf(process.platform === 'win32')('AskpassServer', () => {
  it('answers a client with a valid token and tells the app which repository asks', async () => {
    await start();
    const session = server.session('/repo');
    answers.push('s3cret');
    let output = '';
    const code = await runAskpassClient("Password for 'https://ada@example.com': ", session.env, (text) => (output += text));
    expect(code).toBe(0);
    expect(output).toBe('s3cret\n');
    expect(asked).toEqual([{ id: 1, kind: 'password', prompt: "Password for 'https://ada@example.com': ", repo: '/repo' }]);
    session.dispose();
  });

  it('refuses unknown or disposed tokens without asking, and reports a cancel as failure', async () => {
    await start();
    const session = server.session(null);
    session.dispose();
    expect(await runAskpassClient('Password: ', session.env, () => {})).toBe(1);
    expect(await runAskpassClient('Password: ', { ...session.env, FORKLIFT_ASKPASS_TOKEN: 'forged' }, () => {})).toBe(1);
    expect(asked).toEqual([]);
    const live = server.session(null);
    answers.push(null);
    expect(await runAskpassClient('Password: ', live.env, () => {})).toBe(1);
    expect(await runAskpassClient('Password: ', {}, () => {})).toBe(2);
  });

  it('disposing a session cancels its open prompt', async () => {
    server = new AskpassServer({ scriptDir: dir, command: { executable: '/bin/echo', args: [] }, ask: () => new Promise(() => {}) });
    await server.start();
    const session = server.session(null);
    const pending = runAskpassClient('Password: ', session.env, () => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    session.dispose();
    expect(await pending).toBe(1);
  });

  it('writes a private wrapper that passes the prompt to the app in askpass mode', async () => {
    await start({ executable: '/bin/echo', args: ["it's", 'app dir'] });
    const script = join(dir, 'forklift-askpass.sh');
    expect(statSync(script).mode & 0o777).toBe(0o700);
    expect(execFileSync(script, ['Password for x: ']).toString()).toBe("it's app dir --forklift-askpass Password for x: \n");
  });

  it('works for git itself: git credential fill asks for username and password', async () => {
    // A stand-in for the app in askpass mode: the same protocol in a few lines of Node.
    const client = join(dir, 'client.cjs');
    writeFileSync(
      client,
      `const net = require('node:net'); const prompt = process.argv[process.argv.length - 1];
       const c = net.connect(process.env.FORKLIFT_ASKPASS_SOCKET, () => c.write(JSON.stringify({ token: process.env.FORKLIFT_ASKPASS_TOKEN, prompt }) + '\\n'));
       let b = ''; c.on('data', (d) => { b += d; if (b.includes('\\n')) { const r = JSON.parse(b); if (r.answer !== undefined) { process.stdout.write(r.answer + '\\n'); process.exit(0); } process.exit(1); } });`,
    );
    await start({ executable: process.execPath, args: [client] });
    const session = server.session('/repo');
    answers.push('ada', 'hunter2');
    // Asynchronously: the server answering git lives in this very process.
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        'git',
        ['credential', 'fill'],
        { env: { ...process.env, ...session.env, ELECTRON_RUN_AS_NODE: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
      child.stdin!.end('protocol=https\nhost=example.com\n\n');
    });
    expect(output).toContain('username=ada');
    expect(output).toContain('password=hunter2');
    expect(asked.map((prompt) => prompt.kind)).toEqual(['username', 'password']);
    expect(readFileSync(join(dir, 'forklift-askpass.sh'), 'utf8')).not.toContain('hunter2');
  });
});
