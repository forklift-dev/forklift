import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SavedCredential } from '../../shared/credentials';
import { AtomicFile } from '../atomicFile';

/** Encryption of stored passwords: Electron's safeStorage (the system keychain) in the app. */
export interface SecretBox {
  /** False when there is no safe place for secrets (e.g. Linux without a keyring): nothing is stored then. */
  available(): Promise<boolean>;
  encrypt(text: string): Promise<Buffer>;
  /** `reencrypt`: the keychain's key changed; encrypting the text again keeps it readable later. */
  decrypt(data: Buffer): Promise<{ text: string; reencrypt: boolean }>;
}

/** git's credential description: protocol, host, path (with credential.useHttpPath), username, password. */
export type CredentialFields = Record<string, string>;

interface Entry extends SavedCredential {
  /** Encrypted password, base64. */
  secret: string;
}

const MAX_ENTRIES = 200;

const matches = (entry: SavedCredential, fields: CredentialFields) =>
  entry.protocol === (fields['protocol'] ?? '') &&
  entry.host === (fields['host'] ?? '') &&
  entry.path === (fields['path'] ?? '') &&
  (!fields['username'] || entry.username === fields['username']);

/**
 * Usernames and passwords for HTTPS remotes, encrypted with the system keychain, in userData/credentials.json.
 * Used as a git credential helper: git asks it first, tells it what worked (store) and what was refused (erase).
 */
export class CredentialStore {
  private entries: Entry[] | null = null;
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

  async list(): Promise<SavedCredential[]> {
    return (await this.load()).map(({ id, protocol, host, path, username }) => ({ id, protocol, host, path, username }));
  }

  /** Username and password for a request, or null (then git asks the user). */
  async get(fields: CredentialFields): Promise<CredentialFields | null> {
    if (!(await this.available())) return null;
    const entry = (await this.load()).find((candidate) => matches(candidate, fields));
    if (!entry) return null;
    try {
      const { text, reencrypt } = await this.box.decrypt(Buffer.from(entry.secret, 'base64'));
      if (reencrypt) {
        entry.secret = (await this.box.encrypt(text)).toString('base64');
        await this.save(await this.load());
      }
      return { username: entry.username, password: text };
    } catch {
      // Encrypted by another keychain or user: useless, forget it.
      await this.remove(entry.id);
      return null;
    }
  }

  async store(fields: CredentialFields): Promise<void> {
    const { protocol, host, username, password } = fields;
    if (!protocol || !host || !username || !password) return;
    if ((protocol !== 'https' && protocol !== 'http') || !(await this.available())) return;
    const secret = (await this.box.encrypt(password)).toString('base64');
    const entries = (await this.load()).filter((entry) => !(matches(entry, { ...fields, username }) && entry.username === username));
    entries.unshift({ id: randomBytes(8).toString('hex'), protocol, host, path: fields['path'] ?? '', username, secret });
    await this.save(entries.slice(0, MAX_ENTRIES));
  }

  /** git found the credentials wrong: forget them. */
  async erase(fields: CredentialFields): Promise<void> {
    const entries = await this.load();
    const kept = entries.filter((entry) => !matches(entry, fields));
    if (kept.length !== entries.length) await this.save(kept);
  }

  async remove(id: string): Promise<void> {
    const entries = await this.load();
    const kept = entries.filter((entry) => entry.id !== id);
    if (kept.length !== entries.length) await this.save(kept);
  }

  private async load(): Promise<Entry[]> {
    if (this.entries) return this.entries;
    try {
      const data = JSON.parse(await readFile(this.file.path, 'utf8')) as { entries?: unknown };
      this.entries = Array.isArray(data.entries)
        ? (data.entries as Entry[]).filter((entry) => ['id', 'protocol', 'host', 'path', 'username', 'secret'].every((key) => typeof entry?.[key as keyof Entry] === 'string'))
        : [];
    } catch {
      this.entries = [];
    }
    return this.entries;
  }

  private async save(entries: Entry[]): Promise<void> {
    this.entries = entries;
    await this.file.write(`${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
  }
}

/** "key=value" lines of git's credential protocol (up to a blank line). */
export function parseCredentialFields(text: string): CredentialFields {
  const fields: CredentialFields = {};
  for (const line of text.split('\n')) {
    if (!line) break;
    const equals = line.indexOf('=');
    if (equals > 0) fields[line.slice(0, equals)] = line.slice(equals + 1);
  }
  return fields;
}
