import type { HostingComment, HostingProvider, HostingRepo, IssueDetails, IssueSummary, PullDetails, PullSummary } from '../../shared/hosting';
import { num, str, Transport, type Fetch, type HostingApi, type Json } from './api';
import { GitLabClient } from './gitlab';

export { HostingError, type Fetch, type HostingApi } from './api';

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

const STYLES: Record<Exclude<HostingProvider, 'gitlab'>, ApiStyle> = {
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
  // GitHub: api.github.com (GitHub Enterprise Server: /api/v3), Bearer tokens, its media type and API version
  // (https://docs.github.com/en/rest/about-the-rest-api/api-versions).
  github: {
    base: (server) => (new URL(server).host === 'github.com' ? 'https://api.github.com' : `${server}/api/v3`),
    headers: (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }),
    pageSize: 'per_page',
    issuesOnly: '',
    errorMessage: (body) => str(body['message']),
  },
};

/** The API client for an account's service. */
export function createClient(provider: HostingProvider, server: string, token: string, fetch: Fetch, timeoutMs?: number): HostingApi {
  return provider === 'gitlab' ? new GitLabClient(server, token, fetch, timeoutMs) : new HostingClient(provider, server, token, fetch, timeoutMs);
}

/** A Gitea-style REST API (Forgejo, Gitea, GitVerse, GitHub) with a personal access token. */
export class HostingClient implements HostingApi {
  private readonly style: ApiStyle;
  private readonly transport: Transport;

  constructor(provider: Exclude<HostingProvider, 'gitlab'>, server: string, token: string, fetch: Fetch, timeoutMs = 20_000) {
    this.style = STYLES[provider];
    this.transport = new Transport({ server, base: this.style.base(server), headers: this.style.headers(token), errorMessage: this.style.errorMessage, fetch, timeoutMs });
  }

  pullRef(number: number): string {
    return `refs/pull/${number}/head`;
  }

  private page(page: number) {
    return `page=${page}&${this.style.pageSize}=${PAGE}`;
  }

  /** The token's user: checks the address and the token. */
  async user(): Promise<{ login: string; name: string }> {
    const user = (await this.request('/user')) as Json;
    return { login: login(user), name: str(user['full_name']) || str(user['name']) || login(user) };
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
  async comment(owner: string, name: string, _kind: 'pull' | 'issue', number: number, body: string): Promise<HostingComment> {
    return toComment((await this.request(`/repos/${seg(owner)}/${seg(name)}/issues/${number}/comments`, 'POST', { body })) as Json);
  }

  private async comments(owner: string, name: string, number: number): Promise<HostingComment[]> {
    return ((await this.request(`/repos/${seg(owner)}/${seg(name)}/issues/${number}/comments`)) as Json[]).map(toComment);
  }

  private request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    return this.transport.request(path, method, body);
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
    // Lists on GitHub have merged_at but no merged.
    state: pull['merged'] === true || Boolean(pull['merged_at']) ? 'merged' : str(pull['state']) === 'closed' ? 'closed' : 'open',
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
