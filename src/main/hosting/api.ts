import type { HostingComment, HostingRepo, IssueDetails, IssueSummary, PullDetails, PullSummary } from '../../shared/hosting';

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

export type Json = Record<string, unknown>;
export const str = (value: unknown) => (typeof value === 'string' ? value : '');
export const num = (value: unknown) => (typeof value === 'number' ? value : 0);

/** What the app asks of a hosting service; `owner` may have several parts on GitLab (group/subgroup). */
export interface HostingApi {
  /** The token's user: checks the address and the token. */
  user(): Promise<{ login: string; name: string }>;
  /** Repositories the user can access, most recently updated first. */
  repos(): Promise<HostingRepo[]>;
  repo(owner: string, name: string): Promise<{ defaultBranch: string; webUrl: string }>;
  pulls(owner: string, name: string, state: 'open' | 'closed' | 'all'): Promise<PullSummary[]>;
  pull(owner: string, name: string, number: number): Promise<PullDetails>;
  pullSummary(owner: string, name: string, number: number): Promise<PullSummary>;
  createPull(owner: string, name: string, pull: { head: string; base: string; title: string; body: string }): Promise<PullSummary>;
  issues(owner: string, name: string, state: 'open' | 'closed' | 'all'): Promise<IssueSummary[]>;
  issue(owner: string, name: string, number: number): Promise<IssueDetails>;
  createIssue(owner: string, name: string, issue: { title: string; body: string }): Promise<IssueSummary>;
  comment(owner: string, name: string, kind: 'pull' | 'issue', number: number, body: string): Promise<HostingComment>;
  /** The ref under which the base repository keeps a pull request's head (to fetch it). */
  pullRef(number: number): string;
}

export interface TransportOptions {
  /** Server address (for messages). */
  server: string;
  /** API root. */
  base: string;
  headers: Record<string, string>;
  /** The message of an error response. */
  errorMessage(body: Json): string;
  fetch: Fetch;
  timeoutMs: number;
}

/** JSON requests to a service's API: the token never follows redirects, and failures become plain messages. */
export class Transport {
  constructor(private readonly options: TransportOptions) {}

  /**
   * Where `url` redirects to, asked again without the token (a failed request may have been a redirect, e.g.
   * an old address of the server): the server address to use instead, or null.
   */
  private async redirectTarget(url: string): Promise<string | null> {
    try {
      const probe = await this.options.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.options.timeoutMs), redirect: 'manual' });
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

  async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response;
    const url = `${this.options.base}${path}`;
    try {
      response = await this.options.fetch(url, {
        method,
        headers: { ...this.options.headers, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: controller.signal,
        // The token is never sent on to wherever a redirect points.
        redirect: 'error',
      });
    } catch (error) {
      const host = new URL(this.options.server).host;
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
        message = this.options.errorMessage(JSON.parse(text) as Json);
      } catch {
        // not JSON
      }
      if (response.status === 401) throw new HostingError('The server refused the token (wrong, expired or revoked)', 401);
      // GitHub reports its rate limit as 403 with no requests remaining; others as 429.
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
        const retry = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
        const reset = Number.parseInt(response.headers.get('x-ratelimit-reset') ?? '', 10);
        const wait = Number.isFinite(retry) ? retry : Number.isFinite(reset) ? reset - Date.now() / 1000 : Number.NaN;
        throw new HostingError(`Too many requests to the server${Number.isFinite(wait) ? `: try again in ${Math.max(1, Math.ceil(wait / 60))} min` : ', try again later'}`, 429);
      }
      if (response.status === 403) throw new HostingError(`Not allowed${message ? `: ${message}` : ' (does the token have the needed access?)'}`, 403);
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
