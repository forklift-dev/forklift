import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startForgejoMock, type ForgejoMock } from '../../../tests/e2e/forgejoMock.mjs';
import type { HostingAccount } from '../../shared/hosting';
import { HostingClient, type Fetch } from './client';
import { HostingService } from './service';
import { TokenStore } from './tokens';

// A stand-in for the keychain: reversible, but never the plain text.
const box = {
  available: async () => true,
  encrypt: async (text: string) => Buffer.from(`enc:${text}`),
  decrypt: async (data: Buffer) => ({ text: data.toString().replace(/^enc:/, ''), reencrypt: false }),
};
const fetch: Fetch = (url, init) => globalThis.fetch(url, init);

let mock: ForgejoMock;
let dir: string;
beforeEach(async () => {
  mock = await startForgejoMock();
  dir = mkdtempSync(join(tmpdir(), 'forklift-hosting-test-'));
});
afterEach(async () => {
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
});

describe.each(['forgejo', 'gitverse'] as const)('HostingClient (%s)', (provider) => {
  let served: ForgejoMock;
  beforeEach(async () => {
    served = await startForgejoMock({ flavor: provider });
  });
  afterEach(() => served.close());
  const connect = (token = 'tok-ada', fetcher = fetch, timeout?: number) => new HostingClient(provider, served.url, token, fetcher, timeout);

  it('reads the user, repositories (newest first), pull requests and issues', async () => {
    const client = connect();
    expect(await client.user()).toEqual({ login: 'ada', name: 'Ada Lovelace' });
    expect((await client.repos()).map((repo) => repo.fullName)).toEqual(['ada/secret', 'ada/demo', 'team/tools']);
    const pulls = await client.pulls('ada', 'demo', 'open');
    expect(pulls.map((pull) => [pull.number, pull.head, pull.headRepo, pull.draft])).toEqual([
      [1, 'feature', null, false],
      [2, 'fix', 'eve/demo', true],
    ]);
    expect(pulls[1]?.headCloneUrl).toBe(`${served.url}/eve/demo.git`);
    expect((await client.pulls('ada', 'demo', 'closed'))[0]?.state).toBe('merged');
    const pull = await client.pull('ada', 'demo', 1);
    expect(pull).toMatchObject({ body: 'It adds **the feature**.', mergeable: true, files: [{ path: 'src/feature.txt', additions: 3 }], discussion: [{ author: 'bob', body: 'Looks good to me' }] });
    expect(pull.commits[0]?.message).toMatch(/^Add the feature/);
    const issues = await client.issues('ada', 'demo', 'all');
    expect(issues.map((issue) => [issue.number, issue.state, issue.labels.map((l) => l.name)])).toEqual([
      [3, 'open', ['bug']],
      [4, 'closed', []],
    ]);
    expect((await client.issue('ada', 'demo', 1)).isPull).toBe(true);
  });

  it('creates pull requests, issues and comments', async () => {
    const client = connect();
    const pull = await client.createPull('ada', 'demo', { head: 'topic', base: 'main', title: 'Topic', body: 'Why' });
    expect(pull).toMatchObject({ title: 'Topic', head: 'topic', base: 'main', state: 'open', author: 'ada' });
    const issue = await client.createIssue('ada', 'demo', { title: 'New bug', body: '' });
    expect((await client.issues('ada', 'demo', 'open'))[0]?.number).toBe(issue.number);
    const comment = await client.comment('ada', 'demo', 3, 'Me too');
    expect((await client.issue('ada', 'demo', 3)).discussion).toEqual([comment]);
  });

  it('does not follow redirects with the token, and names the address they lead to', async () => {
    const seen: string[] = [];
    const moved = createServer((req, res) => {
      seen.push(String(req.headers.authorization ?? ''));
      res.writeHead(301, { Location: `${served.url}${req.url}` }).end();
    });
    await new Promise<void>((resolve) => moved.listen(0, '127.0.0.1', resolve));
    try {
      const old = `http://127.0.0.1:${(moved.address() as AddressInfo).port}`;
      await expect(new HostingClient(provider, old, 'tok-ada', fetch).user()).rejects.toThrow(`sends requests on to ${served.url}: add the account with that address`);
      expect(served.requests.some((request) => request.authorized)).toBe(false);
      expect(seen[0]).not.toBe('');
      expect(seen[1]).toBe('');
    } finally {
      await new Promise((resolve) => moved.close(resolve));
    }
  });

  it('explains failures', async () => {
    await expect(connect('wrong').user()).rejects.toThrow(/refused the token/);
    await expect(connect().pull('ada', 'demo', 99)).rejects.toThrow(/Not found on the server: The target/);
    await expect(new HostingClient(provider, 'http://127.0.0.1:1', 'tok-ada', fetch).user()).rejects.toThrow(/Could not reach 127\.0\.0\.1:1/);
    const html: Fetch = async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => '<html>' });
    await expect(connect('t', html).user()).rejects.toThrow(/not answer with JSON/);
    const challenge: Fetch = async () => ({ status: 202, ok: true, headers: { get: () => null }, text: async () => "<html><head><title>Making sure you're not a bot!</title>" });
    await expect(connect('t', challenge).user()).rejects.toThrow(/bot check page/);
    const silent: Fetch = (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(connect('t', silent, 20).user()).rejects.toThrow(/did not answer in time/);
  });
});


it('GitVerse: the API of gitverse.ru is api.gitverse.ru, with Bearer and the API version in Accept', async () => {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const record: Fetch = async (url, init) => {
    seen.push({ url, headers: init.headers });
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => '{"login":"ada","full_name":""}' };
  };
  expect(await new HostingClient('gitverse', 'https://gitverse.ru', 'tok', record).user()).toEqual({ login: 'ada', name: 'ada' });
  expect(seen[0]).toEqual({ url: 'https://api.gitverse.ru/user', headers: { Authorization: 'Bearer tok', Accept: 'application/vnd.gitverse.object+json;version=1' } });
});

it('explains rate limits', async () => {
  const limited: Fetch = async () => ({ status: 429, ok: false, headers: { get: (name) => (name === 'Retry-After' ? '600' : null) }, text: async () => '{"error":{"message":"rate limit"}}' });
  await expect(new HostingClient('gitverse', 'https://gitverse.ru', 'tok', limited).user()).rejects.toThrow(/Too many requests to the server: try again in 10 min/);
});

describe('HostingService', () => {
  let accounts: HostingAccount[];
  let tokens: TokenStore;
  const service = () => new HostingService({ accounts: () => accounts, saveAccounts: async (list) => void (accounts = list), tokens, fetch });
  beforeEach(() => {
    accounts = [];
    tokens = new TokenStore(join(dir, 'tokens.json'), box);
  });

  it('adds an account after checking its token; the token stays out of the account and the file', async () => {
    const hosting = service();
    await expect(hosting.add('forgejo', mock.url, 'wrong')).rejects.toThrow(/refused the token/);
    expect(accounts).toEqual([]);
    const account = await hosting.add('forgejo', `${mock.url}/`, ' tok-ada ');
    expect(account).toMatchObject({ provider: 'forgejo', url: mock.url, username: 'ada', name: 'Ada Lovelace' });
    expect(accounts).toEqual([account]);
    expect(JSON.stringify(accounts)).not.toContain('tok-ada');
    expect(readFileSync(join(dir, 'tokens.json'), 'utf8')).not.toContain('tok-ada');
    // The same user again: the token is replaced, not a second account.
    expect((await hosting.add('forgejo', mock.url, 'tok-ada')).id).toBe(account.id);
    expect(accounts).toHaveLength(1);
    await hosting.remove(account.id);
    expect(accounts).toEqual([]);
    expect(await tokens.get(account.id, mock.url)).toBeNull();
  });

  it('tries an address without a scheme over HTTPS only, and says how to use HTTP', async () => {
    await expect(service().add('forgejo', new URL(mock.url).host, 'tok-ada')).rejects.toThrow(/type its address with http:\/\//);
    expect(mock.requests).toEqual([]);
  });

  it('never sends a token to another server than the one it was given for', async () => {
    const hosting = service();
    const account = await hosting.add('forgejo', mock.url, 'tok-ada');
    // Accounts live in the settings, which the window may edit.
    accounts = [{ ...account, url: 'https://evil.example' }];
    await expect(hosting.client(accounts[0]!)).rejects.toThrow(/No token is saved/);
    expect(await hosting.credential({ protocol: 'https', host: 'evil.example' })).toBeNull();
  });

  it('finds the repository behind the remotes, origin first', async () => {
    const hosting = service();
    await hosting.add('forgejo', mock.url, 'tok-ada');
    const host = new URL(mock.url).host;
    expect(await hosting.context('/r', { upstream: { fetch: 'https://elsewhere.org/a/b.git' } })).toBeNull();
    const context = await hosting.context('/r', { fork: { fetch: `${mock.url}/team/tools.git` }, origin: { fetch: `git@${host.split(':')[0]}:ada/demo.git` } });
    expect(context).toMatchObject({ remote: 'origin', owner: 'ada', name: 'demo', defaultBranch: 'main', webUrl: `${mock.url}/ada/demo` });
    const before = mock.requests.length;
    await hosting.context('/r', { fork: { fetch: `${mock.url}/team/tools.git` }, origin: { fetch: `git@${host.split(':')[0]}:ada/demo.git` } });
    expect(mock.requests.length).toBe(before);
  });

  it('gives git the token for the account’s server only', async () => {
    const hosting = service();
    await hosting.add('forgejo', mock.url, 'tok-ada');
    const host = new URL(mock.url).host;
    expect(await hosting.credential({ protocol: 'http', host, path: 'ada/demo.git' })).toEqual({ username: 'ada', password: 'tok-ada' });
    expect(await hosting.credential({ protocol: 'http', host, username: 'bob' })).toBeNull();
    expect(await hosting.credential({ protocol: 'https', host })).toBeNull();
    expect(await hosting.credential({ protocol: 'http', host: '127.0.0.1:2' })).toBeNull();
  });
});
