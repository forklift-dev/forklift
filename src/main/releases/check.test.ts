import { describe, expect, it, vi } from 'vitest';
import { checkReleases } from './check';

const release = (tag: string, name = 'Forklift-0.6.0.AppImage', draft = false) => ({
  tag_name: tag,
  html_url: `https://github.com/forklift-dev/forklift/releases/tag/${tag}`,
  draft,
  assets: [{ name }],
});
const fetcher = (releases: unknown) => vi.fn(async () => ({ ok: true, json: async () => releases })) as unknown as typeof fetch;

describe('GitHub release check', () => {
  it('selects the newest published release that has an installer for this platform', async () => {
    const fetch = fetcher([release('v0.7.0', 'Forklift-0.7.0-arm64.dmg'), release('v0.6.0'), release('v0.5.1')]);
    expect(await checkReleases('0.5.0', 'linux', 'x64', fetch)).toEqual({ status: 'available', release: { version: '0.6.0', url: 'https://github.com/forklift-dev/forklift/releases/tag/v0.6.0' } });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/forklift/releases?per_page=20'), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('accepts prereleases, but skips drafts, same-version CI builds and untrusted links', async () => {
    const releases = [release('v0.8.0', 'Forklift-0.8.0.AppImage', true), { ...release('v0.7.0'), html_url: 'https://evil.example/update' }, release('v0.6.0-build.23'), release('v0.5.0-build.42')];
    expect(await checkReleases('0.5.0', 'linux', 'x64', fetcher(releases))).toEqual({ status: 'available', release: { version: '0.6.0-build.23', url: 'https://github.com/forklift-dev/forklift/releases/tag/v0.6.0-build.23' } });
    expect(await checkReleases('0.6.0', 'linux', 'x64', fetcher(releases))).toEqual({ status: 'current' });
  });

  it('requires a matching installer and handles bad responses', async () => {
    expect(await checkReleases('0.5.0', 'darwin', 'x64', fetcher([release('v0.6.0')]))).toEqual({ status: 'unsupported' });
    expect(await checkReleases('0.5.0', 'darwin', 'arm64', fetcher([release('v0.6.0', 'Forklift-0.6.0-arm64.dmg')]))).toMatchObject({ status: 'available' });
    await expect(checkReleases('0.5.0', 'linux', 'x64', fetcher({ message: 'error' }))).rejects.toThrow('invalid release list');
  });
});
