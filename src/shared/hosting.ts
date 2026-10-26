// Hosting services (Forgejo, GitVerse, GitHub, GitLab): accounts, and what the app shows of them.
// Tokens never appear here: main keeps them encrypted (safeStorage) and uses them itself.

import { t } from './i18n';

export type HostingProvider = 'forgejo' | 'gitverse' | 'github' | 'gitlab';

export interface ProviderInfo {
  name: string;
  tokenHelp: string;
  /** The service's own server, filled in for the user. */
  server?: string;
  /** What the service calls a pull request. */
  pullTerm?: 'Merge request';
  /** `#` before issue numbers in text; GitLab marks merge requests with `!`. */
  mergeRefs?: boolean;
  /** Repositories may sit in nested groups (group/subgroup/project). */
  nested?: boolean;
}

export const PROVIDERS: Record<HostingProvider, ProviderInfo> = {
  forgejo: { name: 'Forgejo / Gitea', tokenHelp: 'Settings → Applications → Generate new token (repository and issue: read and write; user: read)' },
  gitverse: { name: 'GitVerse', server: 'https://gitverse.ru', tokenHelp: 'gitverse.ru/settings/tokens → create a token with write access (it is shown only once)' },
  github: {
    name: 'GitHub',
    server: 'https://github.com',
    tokenHelp:
      'github.com/settings/tokens → a fine-grained token with Contents, Pull requests and Issues (read and write) and Metadata (read) for the repositories, or a classic token with the “repo” scope',
  },
  gitlab: {
    name: 'GitLab',
    server: 'https://gitlab.com',
    tokenHelp: 'User settings → Access tokens → a personal access token with the “api” scope (“read_api” and “read_repository” only to look)',
    pullTerm: 'Merge request',
    mergeRefs: true,
    nested: true,
  },
};

/** "Pull request" or what the service calls it. */
export const pullTerm = (provider: HostingProvider) => PROVIDERS[provider].pullTerm ?? 'Pull request';

/** How the service writes a pull request's or issue's number: #12, or on GitLab !12 for a merge request. */
export const refLabel = (provider: HostingProvider, kind: 'pull' | 'issue', number: number) => `${kind === 'pull' && PROVIDERS[provider].mergeRefs ? '!' : '#'}${number}`;

/** An account on a server (stored in the settings; its token separately). */
export interface HostingAccount {
  id: string;
  provider: HostingProvider;
  /** Server address, e.g. https://code.example.com (no trailing slash). */
  url: string;
  username: string;
  /** Display name from the server. */
  name: string;
}

export interface HostingRepo {
  fullName: string;
  owner: string;
  name: string;
  description: string;
  private: boolean;
  cloneUrl: string;
  sshUrl: string;
  webUrl: string;
  updatedAt: string;
}

/** The open repository on its server, found from its remotes. */
export interface RepoHosting {
  account: HostingAccount;
  remote: string;
  owner: string;
  name: string;
  webUrl: string;
  defaultBranch: string;
}

export interface HostingComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface PullSummary {
  number: number;
  title: string;
  author: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  /** Branch it brings (in the head repository). */
  head: string;
  /** owner/name of the head repository when it is a fork. */
  headRepo: string | null;
  /** HTTPS clone URL of the head repository (to fetch a fork's branch when the server has no refs/pull/N/head). */
  headCloneUrl: string | null;
  base: string;
  comments: number;
  createdAt: string;
  updatedAt: string;
  webUrl: string;
}

export interface PullDetails extends PullSummary {
  body: string;
  mergeable: boolean | null;
  commits: Array<{ sha: string; message: string; author: string; date: string }>;
  files: Array<{ path: string; status: string; additions: number; deletions: number }>;
  discussion: HostingComment[];
}

export interface IssueSummary {
  number: number;
  title: string;
  author: string;
  state: 'open' | 'closed';
  labels: Array<{ name: string; color: string }>;
  comments: number;
  createdAt: string;
  updatedAt: string;
  webUrl: string;
  /** Forgejo numbers pull requests and issues together; a number may be a pull request. */
  isPull: boolean;
}

export interface IssueDetails extends IssueSummary {
  body: string;
  discussion: HostingComment[];
}

export const MAX_ACCOUNTS = 20;

/** Server address as stored: https URL without path, query or trailing slash (subpath installs keep the path). */
export function normalizeServerUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim().includes('://') ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

/** Validates accounts from the settings file or a window (untrusted). */
export function parseAccounts(value: unknown): HostingAccount[] {
  if (!Array.isArray(value) || value.length > MAX_ACCOUNTS) throw new TypeError(t('Accounts must be a list of up to {count}', { count: MAX_ACCOUNTS }));
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) throw new TypeError(t('Account {account} must be an object', { account: index + 1 }));
    const { id, provider, url, username, name } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id) || ids.has(id)) throw new TypeError(t('Account {account} needs a unique id', { account: index + 1 }));
    ids.add(id);
    if (typeof provider !== 'string' || !Object.hasOwn(PROVIDERS, provider)) throw new TypeError(t('Account {account}: unknown service', { account: index + 1 }));
    const normalized = typeof url === 'string' ? normalizeServerUrl(url) : null;
    if (!normalized || normalized !== url) throw new TypeError(t('Account {account}: "{address}" is not a server address', { account: index + 1, address: String(url) }));
    for (const [field, text] of Object.entries({ username, name })) {
      if (typeof text !== 'string' || text.length > 200 || /[\0\r\n]/.test(text)) {
        const fieldName = field === 'username' ? t('account-field|username') : t('account-field|name');
        throw new TypeError(t('Account {account}: {field} must be one line', { account: index + 1, field: fieldName }));
      }
    }
    return { id, provider: provider as HostingProvider, url: normalized, username: username as string, name: name as string };
  });
}

/**
 * Host and repository path of a remote URL: https://host[:port]/owner/repo(.git), ssh://git@host[:port]/owner/repo,
 * git@host:owner/repo(.git). `path` keeps a server's subpath (e.g. "git/owner/repo").
 */
export function parseRemoteUrl(remote: string): { host: string; path: string } | null {
  const text = remote.trim();
  const scp = /^[\w.-]+@([^:/\s]+):(?!\/)(.+?)(?:\.git)?\/?$/.exec(text);
  if (scp) return { host: scp[1]!.toLowerCase(), path: scp[2]! };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return null;
  const path = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  return path.includes('/') ? { host: url.hostname.toLowerCase(), path } : null;
}

/** Whether a remote is on the account's server; resolves owner and repository name (the last two parts). */
export function matchRemote(account: HostingAccount, remote: string): { owner: string; name: string } | null {
  const parsed = parseRemoteUrl(remote);
  if (!parsed) return null;
  const server = new URL(account.url);
  if (parsed.host !== server.hostname.toLowerCase()) return null;
  // A server installed under a subpath (https://host/git): remote paths carry it too, except over ssh.
  const sub = server.pathname.replace(/^\/+/, '');
  const rest = sub && parsed.path.startsWith(`${sub}/`) ? parsed.path.slice(sub.length + 1) : parsed.path;
  const parts = rest.split('/');
  // owner/name; GitLab also group/subgroup/…/name.
  if (parts.length < 2 || (parts.length > 2 && !PROVIDERS[account.provider].nested) || parts.some((part) => !part)) return null;
  return { owner: parts.slice(0, -1).join('/'), name: parts[parts.length - 1]! };
}
