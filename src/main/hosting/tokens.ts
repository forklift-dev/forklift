import { readFile } from 'node:fs/promises';
import type { SecretBox } from '../askpass/credentials';
import { AtomicFile } from '../atomicFile';

interface Entry {
  /** The server the token was given for: a token is only ever sent there (accounts live in the editable settings). */
  url: string;
  /** Encrypted token, base64. */
  secret: string;
}

/** Access tokens of hosting accounts, encrypted with the system keychain, in their own file (never the settings). */
export class TokenStore {
  private entries: Record<string, Entry> | null = null;
  private readonly file: AtomicFile;

  constructor(
    path: string,
    private readonly box: SecretBox,
  ) {
    this.file = new AtomicFile(path);
  }

  available(): Promise<boolean> {
    return this.box.available();
  }

  /** The account's token, or null when there is none for that server (or the keychain can't read it). */
  async get(id: string, url: string): Promise<string | null> {
    const entry = (await this.load())[id];
    if (!entry || entry.url !== url) return null;
    try {
      const { text, reencrypt } = await this.box.decrypt(Buffer.from(entry.secret, 'base64'));
      if (reencrypt) await this.set(id, url, text);
      return text;
    } catch {
      return null;
    }
  }

  async set(id: string, url: string, token: string): Promise<void> {
    if (!(await this.available())) throw new Error('No system keychain is available, so the token cannot be kept safely');
    const secret = (await this.box.encrypt(token)).toString('base64');
    await this.save({ ...(await this.load()), [id]: { url, secret } });
  }

  async remove(id: string): Promise<void> {
    const entries = { ...(await this.load()) };
    if (!(id in entries)) return;
    delete entries[id];
    await this.save(entries);
  }

  /** Forgets tokens of accounts that are gone (e.g. removed by editing the settings file). */
  async keepOnly(ids: Iterable<string>): Promise<void> {
    const keep = new Set(ids);
    const entries = await this.load();
    const kept = Object.fromEntries(Object.entries(entries).filter(([id]) => keep.has(id)));
    if (Object.keys(kept).length !== Object.keys(entries).length) await this.save(kept);
  }

  private async load(): Promise<Record<string, Entry>> {
    if (this.entries) return this.entries;
    try {
      const data = JSON.parse(await readFile(this.file.path, 'utf8')) as { tokens?: unknown };
      const raw = typeof data.tokens === 'object' && data.tokens !== null ? (data.tokens as Record<string, Partial<Entry>>) : {};
      this.entries = Object.fromEntries(Object.entries(raw).filter(([, entry]) => typeof entry?.url === 'string' && typeof entry.secret === 'string')) as Record<string, Entry>;
    } catch {
      this.entries = {};
    }
    return this.entries;
  }

  private async save(entries: Record<string, Entry>): Promise<void> {
    this.entries = entries;
    await this.file.write(`${JSON.stringify({ version: 1, tokens: entries }, null, 2)}\n`);
  }
}
