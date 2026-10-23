import type { HostingComment, HostingRepo, IssueDetails, IssueSummary, PullDetails, PullSummary } from '../../shared/hosting';

export type Fetch = (url: string, init: { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
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

/** Forgejo's REST API (Gitea-compatible, /api/v1), with a personal access token. */
export class ForgejoClient {
  constructor(
    /** Server address, e.g. https://code.example.com */
    private readonly server: string,
    private readonly token: string,
    private readonly fetch: Fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  /** The token's user: checks the address and the token. */
  async user(): Promise<{ login: string; name: string }> {
    const user = (await this.request('/user')) as Json;
    return { login: login(user), name: str(user['full_name']) || login(user) };
  }

  /** Repositories the user can access, most recently updated first (up to 1000). */
  async repos(): Promise<HostingRepo[]> {
    const repos: HostingRepo[] = [];
    for (let page = 1; page <= 20; page++) {
      const batch = (await this.request(`/user/repos?page=${page}&limit=${PAGE}`)) as Json[];
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
    const list = (await this.request(`/repos/${seg(owner)}/${seg(name)}/pulls?state=${state}&sort=recentupdate&page=1&limit=${PAGE}`)) as Json[];
    return list.map((pull) => toPull(pull, `${owner}/${name}`));
  }

  async pull(owner: string, name: string, number: number): Promise<PullDetails> {
    const base = `/repos/${seg(owner)}/${seg(name)}`;
    const [pull, commits, files, comments] = await Promise.all([
      this.request(`${base}/pulls/${number}`) as Promise<Json>,
      this.request(`${base}/pulls/${number}/commits?page=1&limit=${PAGE}`) as Promise<Json[]>,
      this.request(`${base}/pulls/${number}/files?page=1&limit=${PAGE}`).catch(() => []) as Promise<Json[]>,
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
    const list = (await this.request(`/repos/${seg(owner)}/${seg(name)}/issues?state=${state}&type=issues&page=1&limit=${PAGE}`)) as Json[];
    return list.map(toIssue);
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

  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(`${this.server}/api/v1${path}`, {
        method,
        headers: { Authorization: `token ${this.token}`, Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (error) {
      const host = new URL(this.server).host;
      throw new HostingError(controller.signal.aborted ? `${host} did not answer in time` : `Could not reach ${host}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (!response.ok) {
      let message = '';
      try {
        message = str((JSON.parse(text) as Json)['message']);
      } catch {
        // not JSON
      }
      if (response.status === 401) throw new HostingError('The server refused the token (wrong, expired or revoked)', 401);
      if (response.status === 403) throw new HostingError(`Not allowed${message ? `: ${message}` : ' (does the token have the needed access?)'}`, 403);
      if (response.status === 404) throw new HostingError(`Not found on the server${message ? `: ${message}` : ''}`, 404);
      throw new HostingError(`The server answered ${response.status}${message ? `: ${message}` : ''}`, response.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new HostingError('The server did not answer with JSON: is this the address of a Forgejo or Gitea server?');
    }
  }
}

const seg = (part: string) => encodeURIComponent(part);

function toPull(pull: Json, baseRepo: string): PullSummary {
  const head = (pull['head'] ?? {}) as Json;
  const headRepo = str((head['repo'] as Json | null)?.['full_name']);
  return {
    number: num(pull['number']),
    title: str(pull['title']),
    author: login(pull['user']),
    state: pull['merged'] === true ? 'merged' : str(pull['state']) === 'closed' ? 'closed' : 'open',
    draft: pull['draft'] === true || /^(WIP|\[WIP\]):?\s/i.test(str(pull['title'])),
    head: str(head['ref']),
    headRepo: headRepo && headRepo !== baseRepo ? headRepo : null,
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
