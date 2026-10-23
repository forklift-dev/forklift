import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_AVATAR_REQUEST, normalizeEmail } from '../../shared/avatars';

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface AvatarServiceDeps {
  /** userData/avatars */
  cacheDir: string;
  /** Whether Gravatar is turned on (the setting); when off nothing is fetched. */
  enabled(): boolean;
  fetch: Fetch;
  now?: () => number;
}

const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_RETRY_MS = 10 * 60 * 1000;
const MAX_BYTES = 256 * 1024;
const CONCURRENCY = 4;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Gravatar images, fetched in main (`d=404`: no image means "use initials") and cached on disk for a week,
 * misses too. Offline or failing requests are not retried for a while and leave initials in place.
 */
export class AvatarService {
  private readonly pending = new Map<string, Promise<string | null>>();
  private offlineUntil = 0;
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly deps: AvatarServiceDeps) {}

  /** Data URLs by email, for the ones that have an image; empty when Gravatar is off. */
  async get(emails: unknown): Promise<Record<string, string>> {
    if (!Array.isArray(emails) || emails.length > MAX_AVATAR_REQUEST) throw new TypeError(`emails must be a list of up to ${MAX_AVATAR_REQUEST}`);
    if (!this.deps.enabled()) return {};
    const result: Record<string, string> = {};
    await Promise.all(
      [...new Set(emails.filter((email): email is string => typeof email === 'string' && email.length <= 320 && email.includes('@')))].map(async (email) => {
        const url = await this.one(email);
        if (url) result[email] = url;
      }),
    );
    return result;
  }

  private one(email: string): Promise<string | null> {
    const hash = sha256(normalizeEmail(email));
    let request = this.pending.get(hash);
    if (!request) {
      request = this.load(hash).finally(() => this.pending.delete(hash));
      this.pending.set(hash, request);
    }
    return request;
  }

  private async load(hash: string): Promise<string | null> {
    const now = (this.deps.now ?? Date.now)();
    const image = join(this.deps.cacheDir, `${hash}.img`);
    const miss = join(this.deps.cacheDir, `${hash}.none`);
    const fresh = async (path: string) => {
      const info = await stat(path).catch(() => null);
      return info !== null && now - info.mtimeMs < KEEP_MS;
    };
    if (await fresh(image)) return this.dataUrl(await readFile(image));
    if (await fresh(miss)) return null;
    if (now < this.offlineUntil) return null;

    const response = await this.limited(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const reply = await this.deps.fetch(`https://gravatar.com/avatar/${hash}?s=80&d=404`, { signal: controller.signal });
        const type = (reply.headers.get('content-type') ?? '').split(';')[0]!.trim();
        return { status: reply.status, type, body: reply.status === 200 ? Buffer.from(await reply.arrayBuffer()) : null };
      } finally {
        clearTimeout(timer);
      }
    }).catch(() => null);

    if (!response || (response.status !== 200 && response.status !== 404)) {
      // Offline, blocked or failing: initials for now, try again later.
      this.offlineUntil = now + OFFLINE_RETRY_MS;
      return null;
    }
    await mkdir(this.deps.cacheDir, { recursive: true });
    if (response.status === 404 || !response.body || !TYPES.has(response.type) || response.body.length > MAX_BYTES) {
      await writeFile(miss, '');
      return null;
    }
    // The type travels with the bytes: first line of the cache file.
    const stored = Buffer.concat([Buffer.from(`${response.type}\n`), response.body]);
    await writeFile(image, stored);
    return this.dataUrl(stored);
  }

  private dataUrl(stored: Buffer): string | null {
    const newline = stored.indexOf(10);
    const type = stored.subarray(0, newline).toString();
    if (!TYPES.has(type)) return null;
    return `data:${type};base64,${stored.subarray(newline + 1).toString('base64')}`;
  }

  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= CONCURRENCY) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.running++;
    try {
      return await work();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}
