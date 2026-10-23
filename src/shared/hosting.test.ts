import { describe, expect, it } from 'vitest';
import { matchRemote, normalizeServerUrl, parseAccounts, parseRemoteUrl, type HostingAccount } from './hosting';

const account = (url: string): HostingAccount => ({ id: 'a1', provider: 'forgejo', url, username: 'ada', name: 'Ada' });

describe('normalizeServerUrl', () => {
  it.each([
    ['code.example.com', 'https://code.example.com'],
    ['https://code.example.com/', 'https://code.example.com'],
    ['http://10.0.0.5:3000', 'http://10.0.0.5:3000'],
    ['https://example.com/git/', 'https://example.com/git'],
    ['ftp://example.com', null],
    ['https://user:pw@example.com', null],
    ['https://example.com/?a=1', null],
    ['', null],
  ])('%s → %s', (raw, expected) => expect(normalizeServerUrl(raw)).toBe(expected));
});

describe('parseRemoteUrl', () => {
  it.each([
    ['https://code.example.com/ada/demo.git', { host: 'code.example.com', path: 'ada/demo' }],
    ['https://Code.Example.com:8443/ada/demo/', { host: 'code.example.com', path: 'ada/demo' }],
    ['ssh://git@code.example.com:2222/ada/demo.git', { host: 'code.example.com', path: 'ada/demo' }],
    ['git@code.example.com:ada/demo.git', { host: 'code.example.com', path: 'ada/demo' }],
    ['https://example.com/git/ada/demo.git', { host: 'example.com', path: 'git/ada/demo' }],
    ['/home/ada/demo', null],
    ['https://example.com/demo', null],
  ])('%s', (remote, expected) => expect(parseRemoteUrl(remote)).toEqual(expected));
});

describe('matchRemote', () => {
  it('matches remotes on the account’s server', () => {
    expect(matchRemote(account('https://code.example.com'), 'git@code.example.com:ada/demo.git')).toEqual({ owner: 'ada', name: 'demo' });
    expect(matchRemote(account('https://code.example.com'), 'https://other.com/ada/demo.git')).toBeNull();
    expect(matchRemote(account('https://code.example.com'), 'https://code.example.com/a/b/c.git')).toBeNull();
  });

  it('strips a subpath install from https remotes; ssh ones have none', () => {
    const sub = account('https://example.com/git');
    expect(matchRemote(sub, 'https://example.com/git/ada/demo.git')).toEqual({ owner: 'ada', name: 'demo' });
    expect(matchRemote(sub, 'git@example.com:ada/demo.git')).toEqual({ owner: 'ada', name: 'demo' });
  });
});

describe('parseAccounts', () => {
  it('accepts valid accounts', () => {
    expect(parseAccounts([account('https://code.example.com')])).toEqual([account('https://code.example.com')]);
  });

  it.each([
    ['not a list', 'x'],
    ['an unknown service', [{ ...account('https://a.com'), provider: 'bitbucket' }]],
    ['an address that is not normalized', [account('https://a.com/')]],
    ['duplicate ids', [account('https://a.com'), account('https://b.com')]],
    ['a multi-line name', [{ ...account('https://a.com'), name: 'a\nb' }]],
  ])('rejects %s', (_what, value) => expect(() => parseAccounts(value)).toThrow(TypeError));
});
