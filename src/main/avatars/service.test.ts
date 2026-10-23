import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { colorIndex, initials } from '../../shared/avatars';
import { AvatarService } from './service';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forklift-avatars-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');
function fakeFetch(replies: Record<string, number | 'offline'>) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const hash = /avatar\/([0-9a-f]{64})/.exec(url)![1]!;
    const status = replies[hash] ?? 404;
    if (status === 'offline') throw new Error('net::ERR_INTERNET_DISCONNECTED');
    return { status, headers: { get: () => 'image/png' }, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) };
  };
  return { fetch, calls };
}
const hashOf = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

describe('initials and colors', () => {
  it('takes the first and last word of the name', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('Grace Brewster Murray Hopper')).toBe('GH');
    expect(initials('linus')).toBe('L');
    expect(initials('Анна Каренина')).toBe('АК');
    expect(initials('', 'bot@example.com')).toBe('B');
    expect(initials('  ', '')).toBe('?');
    expect(initials('dependabot[bot]')).toBe('DB');
  });

  it('gives an email the same color every time, case and spaces aside', () => {
    expect(colorIndex('Ada@Example.com ')).toBe(colorIndex('ada@example.com'));
    const spread = new Set(Array.from({ length: 50 }, (_, i) => colorIndex(`user${i}@example.com`)));
    expect(spread.size).toBeGreaterThan(5);
    expect(Math.max(...spread)).toBeLessThan(10);
  });
});

describe('AvatarService', () => {
  it('fetches nothing while Gravatar is off', async () => {
    const { fetch, calls } = fakeFetch({});
    const service = new AvatarService({ cacheDir: dir, enabled: () => false, fetch });
    expect(await service.get(['ada@example.com'])).toEqual({});
    expect(calls).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('fetches by the sha256 of the address, caches images and misses', async () => {
    const { fetch, calls } = fakeFetch({ [hashOf('ada@example.com')]: 200 });
    const service = new AvatarService({ cacheDir: dir, enabled: () => true, fetch });
    const first = await service.get(['Ada@Example.com', 'nobody@example.com', 'not-an-email']);
    expect(Object.keys(first)).toEqual(['Ada@Example.com']);
    expect(first['Ada@Example.com']).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(calls).toEqual([`https://gravatar.com/avatar/${hashOf('ada@example.com')}?s=80&d=404`, `https://gravatar.com/avatar/${hashOf('nobody@example.com')}?s=80&d=404`]);
    // Both answers are on disk now: no second request.
    expect(await service.get(['ada@example.com', 'nobody@example.com'])).toEqual({ 'ada@example.com': first['Ada@Example.com'] });
    expect(calls).toHaveLength(2);
  });

  it('asks again after a week', async () => {
    let now = Date.now();
    const { fetch, calls } = fakeFetch({});
    const service = new AvatarService({ cacheDir: dir, enabled: () => true, fetch, now: () => now });
    await service.get(['a@x.io']);
    now += 8 * 24 * 60 * 60 * 1000;
    await service.get(['a@x.io']);
    expect(calls).toHaveLength(2);
  });

  it('keeps initials when offline and does not retry at once', async () => {
    const { fetch, calls } = fakeFetch({ [hashOf('ada@example.com')]: 'offline' });
    const service = new AvatarService({ cacheDir: dir, enabled: () => true, fetch });
    expect(await service.get(['ada@example.com'])).toEqual({});
    expect(await service.get(['ada@example.com', 'other@example.com'])).toEqual({});
    expect(calls).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('validates requests', async () => {
    const service = new AvatarService({ cacheDir: dir, enabled: () => true, fetch: fakeFetch({}).fetch });
    await expect(service.get('ada@example.com')).rejects.toThrow(/list/);
    await expect(service.get(Array.from({ length: 101 }, (_, i) => `${i}@x.io`))).rejects.toThrow(/up to 100/);
  });
});
