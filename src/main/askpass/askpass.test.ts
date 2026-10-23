import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AskPrompt } from '../../shared/state';
import { runAskpassClient, runCredentialClient } from './client';
import { CredentialStore } from './credentials';
import { classifyPrompt } from './protocol';
import { AskpassServer } from './server';

let dir: string;
let server: AskpassServer;
let asked: AskPrompt[];
let answers: Array<string | null>;
let remembers: boolean[];
let store: CredentialStore | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forklift-askpass-test-'));
  asked = [];
  answers = [];
  remembers = [];
  store = undefined;
});
afterEach(async () => {
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

// A stand-in for the keychain: reversible, but never the plain text.
const box = {
  available: async () => true,
  encrypt: async (text: string) => Buffer.from(`enc:${text}`),
  decrypt: async (data: Buffer) => ({ text: data.toString().replace(/^enc:/, ''), reencrypt: false }),
};

async function start(command = { executable: '/bin/echo', args: [] as string[] }) {
  server = new AskpassServer({
    scriptDir: dir,
    command,
    ...(store && { credentials: store }),
    ask: async (prompt) => {
      asked.push(prompt);
      const answer = answers.shift();
      return answer === undefined || answer === null ? null : { answer, remember: remembers.shift() ?? false };
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

describe('saved credentials', () => {
  const fields = 'protocol=https\nhost=forge.example\n\n';
  const call = async (env: Record<string, string>, action: string, input: string) => {
    let output = '';
    await runCredentialClient(action, input, env, (text) => (output += text));
    return output;
  };

  it('keeps what git confirms when the user asked to remember, gives it back, forgets what git refuses', async () => {
    store = new CredentialStore(join(dir, 'credentials.json'), box);
    await start();
    const first = server.session('/repo');
    expect(first.gitArgs).toEqual(['-c', `credential.helper=!'${join(dir, 'forklift-askpass.sh')}' credential`]);
    expect(await call(first.env, 'get', fields)).toBe('');
    answers.push('ada', 'hunter2');
    remembers.push(false, true);
    await runAskpassClient("Username for 'https://forge.example': ", first.env, () => {});
    await runAskpassClient("Password for 'https://ada@forge.example': ", first.env, () => {});
    await call(first.env, 'store', 'protocol=https\nhost=forge.example\nusername=ada\npassword=hunter2\n\n');
    first.dispose();
    expect(readFileSync(join(dir, 'credentials.json'), 'utf8')).not.toContain('hunter2');

    const second = server.session('/repo');
    expect(await call(second.env, 'get', fields)).toBe('username=ada\npassword=hunter2\n\n');
    // Another host has nothing.
    expect(await call(second.env, 'get', 'protocol=https\nhost=other.example\n\n')).toBe('');
    await call(second.env, 'erase', 'protocol=https\nhost=forge.example\nusername=ada\npassword=hunter2\n\n');
    expect(await call(second.env, 'get', fields)).toBe('');
    expect(await new CredentialStore(join(dir, 'credentials.json'), box).list()).toEqual([]);
  });

  it('stores nothing unless asked to remember', async () => {
    store = new CredentialStore(join(dir, 'credentials.json'), box);
    await start();
    const session = server.session(null);
    answers.push('secret');
    await runAskpassClient("Password for 'https://ada@forge.example': ", session.env, () => {});
    await call(session.env, 'store', 'protocol=https\nhost=forge.example\nusername=ada\npassword=secret\n\n');
    expect(await store.list()).toEqual([]);
  });

  it('background sessions use saved credentials but never ask', async () => {
    store = new CredentialStore(join(dir, 'credentials.json'), box);
    await store.store({ protocol: 'https', host: 'forge.example', username: 'ada', password: 'pw' });
    await start();
    const quiet = server.session('/repo', { interactive: false });
    expect(quiet.env['SSH_ASKPASS_REQUIRE']).toBe('never');
    expect(await call(quiet.env, 'get', fields)).toBe('username=ada\npassword=pw\n\n');
    answers.push('should not be used');
    expect(await runAskpassClient('Password: ', quiet.env, () => {})).toBe(1);
    expect(asked).toEqual([]);
  });

  it('works for git itself: credential fill takes saved credentials without asking', async () => {
    store = new CredentialStore(join(dir, 'credentials.json'), box);
    await store.store({ protocol: 'https', host: 'forge.example', username: 'ada', password: 'pw' });
    // A stand-in for the app in credential helper mode: the same protocol in a few lines of Node.
    const client = join(dir, 'client.cjs');
    writeFileSync(
      client,
      `const net = require('node:net'); const [mode, action] = process.argv.slice(-2);
       let input = ''; process.stdin.on('data', (d) => (input += d)); process.stdin.on('end', () => {
         const fields = Object.fromEntries(input.split('\\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
         const c = net.connect(process.env.FORKLIFT_ASKPASS_SOCKET, () => c.write(JSON.stringify({ token: process.env.FORKLIFT_ASKPASS_TOKEN, credential: { action, fields } }) + '\\n'));
         let b = ''; c.on('data', (d) => { b += d; if (b.includes('\\n')) { const r = JSON.parse(b); for (const [k, v] of Object.entries(r.fields || {})) process.stdout.write(k + '=' + v + '\\n'); process.exit(0); } });
       });`,
    );
    await start({ executable: process.execPath, args: [client] });
    const session = server.session('/repo');
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        'git',
        [...session.gitArgs!, 'credential', 'fill'],
        { env: { ...process.env, ...session.env, ELECTRON_RUN_AS_NODE: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
      child.stdin!.end('protocol=https\nhost=forge.example\n\n');
    });
    expect(output).toContain('username=ada');
    expect(output).toContain('password=pw');
    expect(asked).toEqual([]);
  });
});

describe('CredentialStore', () => {
  it('encrypts again when the keychain asks for it', async () => {
    const path = join(dir, 'c.json');
    await new CredentialStore(path, box).store({ protocol: 'https', host: 'a.example', username: 'ada', password: 'pw' });
    const rotated = new CredentialStore(path, { ...box, decrypt: async (data: Buffer) => ({ text: data.toString().replace(/^(enc|new):/, ''), reencrypt: data.toString().startsWith('enc:') }), encrypt: async (text: string) => Buffer.from(`new:${text}`) });
    expect(await rotated.get({ protocol: 'https', host: 'a.example' })).toEqual({ username: 'ada', password: 'pw' });
    expect(readFileSync(path, 'utf8')).toContain(Buffer.from('new:pw').toString('base64'));
  });

  it('stores HTTPS credentials only, per host and path, newest first', async () => {
    const credentials = new CredentialStore(join(dir, 'c.json'), box);
    await credentials.store({ protocol: 'https', host: 'a.example', username: 'ada', password: '1' });
    await credentials.store({ protocol: 'https', host: 'a.example', path: 'team/x.git', username: 'ada', password: '2' });
    await credentials.store({ protocol: 'ssh', host: 'a.example', username: 'ada', password: '3' });
    await credentials.store({ protocol: 'https', host: 'a.example', username: 'ada', password: '4' });
    expect((await credentials.list()).map((c) => [c.host, c.path, c.username])).toEqual([
      ['a.example', '', 'ada'],
      ['a.example', 'team/x.git', 'ada'],
    ]);
    expect(await credentials.get({ protocol: 'https', host: 'a.example' })).toEqual({ username: 'ada', password: '4' });
    expect(await credentials.get({ protocol: 'https', host: 'a.example', path: 'team/x.git' })).toEqual({ username: 'ada', password: '2' });
    expect(await credentials.get({ protocol: 'https', host: 'a.example', username: 'bob' })).toBeNull();
    const [first] = await credentials.list();
    await credentials.remove(first!.id);
    expect(await credentials.get({ protocol: 'https', host: 'a.example' })).toBeNull();
  });

  it('keeps nothing without a keychain, and drops entries it cannot decrypt', async () => {
    const none = new CredentialStore(join(dir, 'none.json'), { ...box, available: async () => false });
    await none.store({ protocol: 'https', host: 'a.example', username: 'ada', password: '1' });
    expect(await none.list()).toEqual([]);
    const path = join(dir, 'c.json');
    await new CredentialStore(path, box).store({ protocol: 'https', host: 'a.example', username: 'ada', password: '1' });
    const broken = new CredentialStore(path, { ...box, decrypt: async () => Promise.reject(new Error('other keychain')) });
    expect(await broken.get({ protocol: 'https', host: 'a.example' })).toBeNull();
    expect(await broken.list()).toEqual([]);
  });
});
