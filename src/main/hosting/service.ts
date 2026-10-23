import { randomBytes } from 'node:crypto';
import { MAX_ACCOUNTS, matchRemote, normalizeServerUrl, type HostingAccount, type HostingProvider, type HostingRepo, type RepoHosting } from '../../shared/hosting';
import type { CredentialFields } from '../askpass/credentials';
import { HostingClient, HostingError, type Fetch } from './client';
import type { TokenStore } from './tokens';

export interface HostingDeps {
  accounts(): HostingAccount[];
  saveAccounts(accounts: HostingAccount[]): Promise<void>;
  tokens: Pick<TokenStore, 'get' | 'set' | 'remove' | 'keepOnly'>;
  fetch: Fetch;
}

const MAX_TOKEN = 1000;

/** Accounts on hosting servers, their API clients, and which server an open repository lives on. */
export class HostingService {
  /** Repository → its server (or null), by the remotes it had when asked. */
  private readonly contexts = new Map<string, { key: string; value: Promise<RepoHosting | null> }>();

  constructor(private readonly deps: HostingDeps) {}

  accounts(): HostingAccount[] {
    return this.deps.accounts();
  }

  /** Checks the token with the server, then keeps the account (the same user on the same server: a new token). */
  async add(provider: HostingProvider, rawUrl: string, token: string): Promise<HostingAccount> {
    const url = normalizeServerUrl(rawUrl);
    if (!url) throw new Error(`"${rawUrl}" is not a server address`);
    const trimmed = token.trim();
    if (!trimmed || trimmed.length > MAX_TOKEN || /\s/.test(trimmed)) throw new Error('The token must be one word, as the server showed it');
    const user = await new HostingClient(provider, url, trimmed, this.deps.fetch).user().catch((error: unknown) => {
      // An address typed without a scheme is tried over HTTPS only; never quietly over plain HTTP (the token would travel unencrypted).
      if (error instanceof HostingError && error.status === null && !rawUrl.includes('://')) throw new HostingError(`${error.message}. If the server has no HTTPS, type its address with http://`);
      throw error;
    });
    if (!user.login) throw new HostingError('The server did not say whose token this is');
    const accounts = this.accounts();
    const existing = accounts.find((account) => account.provider === provider && account.url === url && account.username === user.login);
    if (!existing && accounts.length >= MAX_ACCOUNTS) throw new Error(`Up to ${MAX_ACCOUNTS} accounts can be added`);
    const account: HostingAccount = { id: existing?.id ?? randomBytes(6).toString('hex'), provider, url, username: user.login, name: user.name };
    await this.deps.tokens.set(account.id, url, trimmed);
    await this.deps.saveAccounts(existing ? accounts.map((a) => (a.id === account.id ? account : a)) : [...accounts, account]);
    this.contexts.clear();
    return account;
  }

  async remove(id: string): Promise<void> {
    await this.deps.saveAccounts(this.accounts().filter((account) => account.id !== id));
    await this.deps.tokens.remove(id);
    // Also tokens of accounts removed by editing the settings file.
    await this.deps.tokens.keepOnly(this.accounts().map((account) => account.id));
    this.contexts.clear();
  }

  account(id: string): HostingAccount {
    const account = this.accounts().find((candidate) => candidate.id === id);
    if (!account) throw new Error('There is no such account');
    return account;
  }

  async client(account: HostingAccount): Promise<HostingClient> {
    const token = await this.deps.tokens.get(account.id, account.url);
    if (!token) throw new HostingError(`No token is saved for ${account.username} on ${new URL(account.url).host}: add the account again in Preferences → Integrations`);
    return new HostingClient(account.provider, account.url, token, this.deps.fetch);
  }

  async repos(accountId: string): Promise<HostingRepo[]> {
    return (await this.client(this.account(accountId))).repos();
  }

  /**
   * The server and repository behind a repository's remotes (origin first), or null when no account matches.
   * Asks the server for the default branch; cached until the remotes or the accounts change.
   */
  context(root: string, remoteUrls: Record<string, { fetch: string; push?: string }>): Promise<RepoHosting | null> {
    const accounts = this.accounts();
    const key = JSON.stringify([remoteUrls, accounts.map((account) => account.id)]);
    const cached = this.contexts.get(root);
    if (cached?.key === key) return cached.value;
    const value = this.resolve(remoteUrls, accounts);
    this.contexts.set(root, { key, value });
    // A failure (server down) is not remembered.
    value.catch(() => this.contexts.get(root)?.value === value && this.contexts.delete(root));
    return value;
  }

  private async resolve(remoteUrls: Record<string, { fetch: string; push?: string }>, accounts: HostingAccount[]): Promise<RepoHosting | null> {
    const names = Object.keys(remoteUrls).sort((a, b) => (a === 'origin' ? -1 : b === 'origin' ? 1 : a.localeCompare(b)));
    for (const remote of names) {
      for (const account of accounts) {
        const found = matchRemote(account, remoteUrls[remote]!.fetch);
        if (!found) continue;
        const repo = await (await this.client(account)).repo(found.owner, found.name);
        return { account, remote, owner: found.owner, name: found.name, webUrl: repo.webUrl, defaultBranch: repo.defaultBranch };
      }
    }
    return null;
  }

  /**
   * For git's credential helper: the account's username and token for an HTTPS request to its server (when
   * the user saved no password of their own for it). A subpath install only matches requests under its path.
   */
  async credential(fields: CredentialFields): Promise<CredentialFields | null> {
    const { protocol, host } = fields;
    if ((protocol !== 'https' && protocol !== 'http') || !host) return null;
    for (const account of this.accounts()) {
      const server = new URL(account.url);
      if (server.protocol !== `${protocol}:` || server.host.toLowerCase() !== host.toLowerCase()) continue;
      if (fields['username'] && fields['username'] !== account.username) continue;
      const sub = server.pathname.replace(/^\/+/, '');
      if (sub && fields['path'] !== undefined && !fields['path'].startsWith(`${sub}/`)) continue;
      const token = await this.deps.tokens.get(account.id, account.url);
      if (token) return { username: account.username, password: token };
    }
    return null;
  }
}
