import type { HostingComment, HostingProvider, HostingRepo, IssueDetails, IssueSummary, PullDetails, PullSummary } from '../../shared/hosting';

export type Fetch = (
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: 'error' | 'manual' },
) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export class HostingError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'HostingError';
  }
}

type Json = Record<string, unknown>;
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const num = (value: unknown) => (typeof value === 'number' ? value : 0);
const login = (user: unknown) => str((user as Json | null)?.['login']);

const PAGE = 50;

/** How a service's REST API differs; the paths and fields are the same (GitVerse follows Gitea and GitHub). */
interface ApiStyle {
  /** API root for a server address. */
  base(server: string): string;
  headers(token: string): Record<string, string>;
  /** Name of the page size parameter. */
  pageSize: string;
  /** Extra filter for listing issues without pull requests, if the service has one. */
  issuesOnly: string;
  /** The message of an error response. */
  errorMessage(body: Json): string;
}

const STYLES: Record<HostingProvider, ApiStyle> = {
  // Forgejo and Gitea: /api/v1 on the server, "token" authorization.
  forgejo: {
    base: (server) => `${server}/api/v1`,
    headers: (token) => ({ Authorization: `token ${token}`, Accept: 'application/json' }),
    pageSize: 'limit',
    issuesOnly: '&type=issues',
    errorMessage: (body) => str(body['message']),
  },
  // GitVerse: the public instance serves its API from api.gitverse.ru (other installations under /api), Bearer
  // tokens, and the API version in Accept (https://gitverse.ru/docs/developers/public-api/).
  gitverse: {
    base: (server) => (new URL(server).host === 'gitverse.ru' ? 'https://api.gitverse.ru' : `${server}/api`),
    headers: (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.gitverse.object+json;version=1' }),
    pageSize: 'per_page',
    issuesOnly: '',
    errorMessage: (body) => str((body['error'] as Json | undefined)?.['message']) || str(body['message']),
  },
};

/** A Gitea-style REST API (Forgejo, Gitea, GitVerse) with a personal access token. */
export class HostingClient {
  private readonly style: ApiStyle;

  constructor(
    provider: HostingProvider,
    /** Server address, e.g. https://code.example.com */
    private readonly server: string,
    private readonly token: string,
    private readonly fetch: Fetch,
    private readonly timeoutMs = 20_000,
  ) {
    this.style = STYLES[provider];
  }

  private page(page: number) {
    return `page=${page}&${this.style.pageSize}=${PAGE}`;
  }

  /** The token's user: checks the address and the token. */
  async user(): Promise<{ login: string; name: string }> {
    const user = (await this.request('/user')) as Json;
    return { login: login(user), name: str(user['full_name']) || login(user) };
  }

  /** Repositories the user can access, most recently updated first (up to 1000). */
  async repos(): Promise<HostingRepo[]> {
    const repos: HostingRepo[] = [];
    for (let page = 1; page <= 20; page++) {
      const batch = (await this.request(`/user/repos?${this.page(page)}`)) as Json[];
      for (const repo of batch) {
        repos.push({
          fullName: str(repo['full_name']),
          owner: login(repo['owner']),
          name: str(repo['name']),
          description: str(repo['description']),
          private: repo['private'] === true,
          cloneUrl: str(repo['clone_url']),
          sshUrl: str(repo['ssh_url']),
          webUrl: str(repo['html_url']),
          updatedAt: str(repo['updated_at']),
        });
      }
      if (batch.length < PAGE) break;
    }
    return repos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async repo(owner: string, name: string): Promise<{ defaultBranch: string; webUrl: string }> {
    const repo = (await this.request(`/repos/${seg(owner)}/${seg(name)}`)) as Json;
    return { defaultBranch: str(repo['default_branch']) || 'main', webUrl: str(repo['html_url']) };
  }

  async pulls(owner: string, name: string, state: 'open' | 'closed' | 'all'): Promise<PullSummary[]> {
    const list = (await this.request(`/repos/${seg(owner)}/${seg(name)}/pulls?state=${state}&${this.page(1)}`)) as Json[];
    return list.map((pull) => toPull(pull, `${owner}/${name}`));
  }

  async pull(owner: string, name: string, number: number): Promise<PullDetails> {
    const base = `/repos/${seg(owner)}/${seg(name)}`;
    const [pull, commits, files, comments] = await Promise.all([
      this.request(`${base}/pulls/${number}`) as Promise<Json>,
      this.request(`${base}/pulls/${number}/commits?${this.page(1)}`) as Promise<Json[]>,
      this.request(`${base}/pulls/${number}/files?${this.page(1)}`).catch(() => []) as Promise<Json[]>,
      this.comments(owner, name, number),
    ]);
    return {
      ...toPull(pull, `${owner}/${name}`),
      body: str(pull['body']),
      mergeable: typeof pull['mergeable'] === 'boolean' ? pull['mergeable'] : null,
      commits: commits.map((commit) => {
        const inner = (commit['commit'] ?? {}) as Json;
        const author = (inner['author'] ?? {}) as Json;
        return { sha: str(commit['sha']), message: str(inner['message']), author: str(author['name']), date: str(author['date']) };
      }),
      files: files.map((file) => ({ path: str(file['filename']), status: str(file['status']), additions: num(file['additions']), deletions: num(file['deletions']) })),
      discussion: comments,
    };
  }

  async pullSummary(owner: string, name: string, number: number): Promise<PullSummary> {
    return toPull((await this.request(`/repos/${seg(owner)}/${seg(name)}/pulls/${number}`)) as Json, `${owner}/${name}`);
  }

  async createPull(owner: string, name: string, pull: { head: string; base: string; title: string; body: string }): Promise<PullSummary> {
    const created = (await this.request(`/repos/${seg(owner)}/${seg(name)}/pulls`, 'POST', pull)) as Json;
    return toPull(created, `${owner}/${name}`);
  }

  async issues(owner: string, name: string, state: 'open' | 'closed' | 'all'): Promise<IssueSummary[]> {
    const list = (await this.request(`/repos/${seg(owner)}/${seg(name)}/issues?state=${state}${this.style.issuesOnly}&${this.page(1)}`)) as Json[];
    // Pull requests are issues too; services without a filter list both.
    return list.map(toIssue).filter((issue) => !issue.isPull);
  }

  async issue(owner: string, name: string, number: number): Promise<IssueDetails> {
    const [issue, comments] = await Promise.all([this.request(`/repos/${seg(owner)}/${seg(name)}/issues/${number}`) as Promise<Json>, this.comments(owner, name, number)]);
    return { ...toIssue(issue), body: str(issue['body']), discussion: comments };
  }

  async createIssue(owner: string, name: string, issue: { title: string; body: string }): Promise<IssueSummary> {
    return toIssue((await this.request(`/repos/${seg(owner)}/${seg(name)}/issues`, 'POST', issue)) as Json);
  }

  /** Pull requests and issues share their comments (an issue number for both). */
  async comment(owner: string, name: string, number: number, body: string): Promise<HostingComment> {
    return toComment((await this.request(`/repos/${seg(owner)}/${seg(name)}/issues/${number}/comments`, 'POST', { body })) as Json);
  }

  private async comments(owner: string, name: string, number: number): Promise<HostingComment[]> {
    return ((await this.request(`/repos/${seg(owner)}/${seg(name)}/issues/${number}/comments`)) as Json[]).map(toComment);
  }

  /**
   * Where `url` redirects to, asked again without the token (a failed request may have been a redirect, e.g.
   * an old address of the server): the server address to use instead, or null.
   */
  private async redirectTarget(url: string): Promise<string | null> {
    try {
      const probe = await this.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'manual' });
      const location = probe.status >= 300 && probe.status < 400 ? probe.headers.get('Location') : null;
      if (!location) return null;
      const target = new URL(location, url);
      // The same API path on the new server: its address is what comes before it; otherwise just its origin.
      const apiPath = new URL(url).pathname;
      const prefix = target.pathname.endsWith(apiPath) ? target.pathname.slice(0, -apiPath.length) : '';
      return `${target.origin}${prefix}`;
    } catch {
      return null;
    }
  }

  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    const url = `${this.style.base(this.server)}${path}`;
    try {
      response = await this.fetch(url, {
        method,
        headers: { ...this.style.headers(this.token), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: controller.signal,
        // The token is never sent on to wherever a redirect points.
        redirect: 'error',
      });
    } catch (error) {
      const host = new URL(this.server).host;
      if (controller.signal.aborted) throw new HostingError(`${host} did not answer in time`);
      const moved = await this.redirectTarget(url);
      if (moved) throw new HostingError(`${host} sends requests on to ${moved}: add the account with that address`);
      throw new HostingError(`Could not reach ${host}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (!response.ok) {
      let message = '';
      try {
        message = this.style.errorMessage(JSON.parse(text) as Json);
      } catch {
        // not JSON
      }
      if (response.status === 401) throw new HostingError('The server refused the token (wrong, expired or revoked)', 401);
      if (response.status === 403) throw new HostingError(`Not allowed${message ? `: ${message}` : ' (does the token have the needed access?)'}`, 403);
      if (response.status === 429) {
        const wait = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
        throw new HostingError(`Too many requests to the server${Number.isFinite(wait) ? `: try again in ${Math.ceil(wait / 60)} min` : ', try again later'}`, 429);
      }
      if (response.status === 404) throw new HostingError(`Not found on the server${message ? `: ${message}` : ''}`, 404);
      throw new HostingError(`The server answered ${response.status}${message ? `: ${message}` : ''}`, response.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new HostingError(
        /<title>[^<]*bot/i.test(text)
          ? 'The server answered with a bot check page instead of its API (its bot protection let no app through)'
          : 'The server did not answer with JSON: is this the right server address for the service?',
      );
    }
  }
}

const seg = (part: string) => encodeURIComponent(part);

function toPull(pull: Json, baseRepo: string): PullSummary {
  const head = (pull['head'] ?? {}) as Json;
  const headRepoJson = (head['repo'] ?? null) as Json | null;
  const headRepo = str(headRepoJson?.['full_name']);
  return {
    number: num(pull['number']),
    title: str(pull['title']),
    author: login(pull['user']),
    state: pull['merged'] === true ? 'merged' : str(pull['state']) === 'closed' ? 'closed' : 'open',
    draft: pull['draft'] === true || /^(WIP|\[WIP\]):?\s/i.test(str(pull['title'])),
    head: str(head['ref']),
    headRepo: headRepo && headRepo !== baseRepo ? headRepo : null,
    headCloneUrl: str(headRepoJson?.['clone_url']) || null,
    base: str(((pull['base'] ?? {}) as Json)['ref']),
    comments: num(pull['comments']),
    createdAt: str(pull['created_at']),
    updatedAt: str(pull['updated_at']),
    webUrl: str(pull['html_url']),
  };
}

function toIssue(issue: Json): IssueSummary {
  return {
    number: num(issue['number']),
    title: str(issue['title']),
    author: login(issue['user']),
    state: str(issue['state']) === 'closed' ? 'closed' : 'open',
    labels: (Array.isArray(issue['labels']) ? (issue['labels'] as Json[]) : []).map((label) => ({ name: str(label['name']), color: str(label['color']) })),
    comments: num(issue['comments']),
    createdAt: str(issue['created_at']),
    updatedAt: str(issue['updated_at']),
    webUrl: str(issue['html_url']),
    isPull: Boolean(issue['pull_request']),
  };
}

const toComment = (comment: Json): HostingComment => ({ id: num(comment['id']), author: login(comment['user']), body: str(comment['body']), createdAt: str(comment['created_at']) });
