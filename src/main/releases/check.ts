import type { ReleaseCheck } from '../../shared/releases';

const API = 'https://api.github.com/repos/forklift-dev/forklift/releases?per_page=20';
const RELEASE_URL = /^https:\/\/github\.com\/forklift-dev\/forklift\/releases\/tag\/[^/?#]+$/;

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  assets?: unknown;
}

function versionParts(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value);
  return match ? match.slice(1, 4).map(Number) : null;
}

function newer(candidate: string, current: string): boolean {
  const left = versionParts(candidate);
  const right = versionParts(current);
  if (!left || !right) return false;
  // A same-version CI build has no distinct app version, so it cannot safely update another build.
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! > right[i]!;
  return false;
}

function hasInstaller(release: GitHubRelease, platform: string, arch: string): boolean {
  if (!Array.isArray(release.assets)) return false;
  const suffix = platform === 'linux' && arch === 'x64' ? '.AppImage'
    : platform === 'win32' && arch === 'x64' ? '.exe'
      : platform === 'darwin' && arch === 'arm64' ? '.dmg' : null;
  if (!suffix) return false;
  return release.assets.some((asset: unknown) => {
    if (!asset || typeof asset !== 'object' || !('name' in asset) || typeof asset.name !== 'string') return false;
    if (!asset.name.endsWith(suffix)) return false;
    if (platform === 'darwin') return asset.name.includes('arm64');
    return !asset.name.includes('arm64');
  });
}

/** Checks published GitHub Releases; it never downloads or installs an asset. */
export async function checkReleases(currentVersion: string, platform: string, arch: string, fetcher: typeof fetch): Promise<ReleaseCheck> {
  if (!((platform === 'linux' || platform === 'win32') && arch === 'x64') && !(platform === 'darwin' && arch === 'arm64')) return { status: 'unsupported' };
  const response = await fetcher(API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Forklift/${currentVersion}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error('GitHub returned an invalid release list');
  let latest: { version: string; url: string } | null = null;
  for (const entry of data as GitHubRelease[]) {
    if (!entry || entry.draft || typeof entry.tag_name !== 'string' || typeof entry.html_url !== 'string') continue;
    if (!RELEASE_URL.test(entry.html_url) || !newer(entry.tag_name, currentVersion) || !hasInstaller(entry, platform, arch)) continue;
    if (!latest || newer(entry.tag_name, latest.version)) latest = { version: entry.tag_name.replace(/^v/, ''), url: entry.html_url };
  }
  return latest ? { status: 'available', release: latest } : { status: 'current' };
}
