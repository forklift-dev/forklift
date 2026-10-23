import type { HostingComment, HostingRepo, IssueDetails, IssueSummary, PullDetails, PullSummary } from '../../shared/hosting';
import { num, str, Transport, type Fetch, type HostingApi, type Json } from './api';

const PAGE = 50;
const username = (user: unknown) => str((user as Json | null)?.['username']);
/** GitLab addresses a project by its numeric id or its URL-encoded path ("group/sub/project"). */
const project = (owner: string, name: string) => `/projects/${encodeURIComponent(`${owner}/${name}`)}`;
const STATES = { open: 'opened', closed: 'closed', all: 'all' } as const;

/** GitLab's REST API v4 (gitlab.com or a self-managed server) with a personal access token. */
export class GitLabClient implements HostingApi {
  private readonly transport: Transport;
  /** Forks' paths and clone URLs by project id. */
  private readonly projects = new Map<number, Promise<{ path: string; cloneUrl: string } | null>>();

  constructor(server: string, token: string, fetch: Fetch, timeoutMs = 20_000) {
    this.transport = new Transport({
      server,
      base: `${server}/api/v4`,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      // {"message": "..."}, {"message": {"field": ["..."]}} or {"error": "...", "error_description": "..."}.
      errorMessage: (body) => {
        const message = body['message'];
        if (typeof message === 'string') return message;
        if (typeof message === 'object' && message !== null) return Object.entries(message).map(([field, text]) => `${field} ${([] as unknown[]).concat(text).join(', ')}`).join('; ');
        return str(body['error_description']) || str(body['error']);
      },
      fetch,
      timeoutMs,
    });
  }

  pullRef(number: number): string {
    return `refs/merge-requests/${number}/head`;
  }

  async user(): Promise<{ login: string; name: string }> {
    const user = (await this.request('/user')) as Json;
    return { login: username(user), name: str(user['name']) || username(user) };
  }

  /** Projects the user is a member of, most recently active first (up to 1000). */
  async repos(): Promise<HostingRepo[]> {
    const repos: HostingRepo[] = [];
    for (let page = 1; page <= 20; page++) {
      const batch = (await this.request(`/projects?membership=true&order_by=last_activity_at&sort=desc&page=${page}&per_page=${PAGE}`)) as Json[];
      for (const repo of batch) {
        repos.push({
          fullName: str(repo['path_with_namespace']),
          owner: str((repo['namespace'] as Json | null)?.['full_path']),
          name: str(repo['path']),
          description: str(repo['description']),
          private: str(repo['visibility']) !== 'public',
          cloneUrl: str(repo['http_url_to_repo']),
          sshUrl: str(repo['ssh_url_to_repo']),
          webUrl: str(repo['web_url']),
          updatedAt: str(repo['last_activity_at']),
        });
      }
      if (batch.length < PAGE) break;
    }
    return repos;
  }

  async repo(owner: string, name: string): Promise<{ defaultBranch: string; webUrl: string }> {
    const repo = (await this.request(project(owner, name))) as Json;
    return { defaultBranch: str(repo['default_branch']) || 'main', webUrl: str(repo['web_url']) };
  }

  async pulls(owner: string, name: string, state: 'open' | 'closed' | 'all'): Promise<PullSummary[]> {
    // GitLab's "closed" leaves merged ones out; elsewhere closed includes them.
    const list = (await this.request(`${project(owner, name)}/merge_requests?state=${state === 'closed' ? 'all' : STATES[state]}&order_by=updated_at&per_page=${PAGE}`)) as Json[];
    const shown = state === 'closed' ? list.filter((mr) => str(mr['state']) !== 'opened') : list;
    return Promise.all(shown.map((mr) => this.toPull(mr)));
  }

  async pull(owner: string, name: string, number: number): Promise<PullDetails> {
    const base = `${project(owner, name)}/merge_requests/${number}`;
    const [mr, commits, files, discussion] = await Promise.all([
      this.request(base) as Promise<Json>,
      this.request(`${base}/commits?per_page=${PAGE}`) as Promise<Json[]>,
      this.files(base),
      this.notes(`${base}/notes`),
    ]);
    return {
      ...(await this.toPull(mr)),
      body: str(mr['description']),
      mergeable: typeof mr['has_conflicts'] === 'boolean' ? !mr['has_conflicts'] : null,
      commits: commits.map((commit) => ({ sha: str(commit['id']), message: str(commit['message']), author: str(commit['author_name']), date: str(commit['authored_date']) })),
      files,
      discussion,
    };
  }

  async pullSummary(owner: string, name: string, number: number): Promise<PullSummary> {
    return this.toPull((await this.request(`${project(owner, name)}/merge_requests/${number}`)) as Json);
  }

  async createPull(owner: string, name: string, pull: { head: string; base: string; title: string; body: string }): Promise<PullSummary> {
    const created = (await this.request(`${project(owner, name)}/merge_requests`, 'POST', { source_branch: pull.head, target_branch: pull.base, title: pull.title, description: pull.body })) as Json;
    return this.toPull(created);
  }

  async issues(owner: string, name: string, state: 'open' | 'closed' | 'all'): Promise<IssueSummary[]> {
    const list = (await this.request(`${project(owner, name)}/issues?state=${STATES[state]}&with_labels_details=true&order_by=updated_at&per_page=${PAGE}`)) as Json[];
    return list.map(toIssue);
  }

  async issue(owner: string, name: string, number: number): Promise<IssueDetails> {
    const base = `${project(owner, name)}/issues/${number}`;
    const [issue, discussion] = await Promise.all([this.request(base) as Promise<Json>, this.notes(`${base}/notes`)]);
    return { ...toIssue(issue), body: str(issue['description']), discussion };
  }

  async createIssue(owner: string, name: string, issue: { title: string; body: string }): Promise<IssueSummary> {
    return toIssue((await this.request(`${project(owner, name)}/issues`, 'POST', { title: issue.title, description: issue.body })) as Json);
  }

  /** Merge requests and issues are numbered separately, each with its own notes. */
  async comment(owner: string, name: string, kind: 'pull' | 'issue', number: number, body: string): Promise<HostingComment> {
    return toComment((await this.request(`${project(owner, name)}/${kind === 'pull' ? 'merge_requests' : 'issues'}/${number}/notes`, 'POST', { body })) as Json);
  }

  /** People's comments, oldest first (GitLab's own "changed the description" notes left out). */
  private async notes(path: string): Promise<HostingComment[]> {
    const notes = (await this.request(`${path}?sort=asc&order_by=created_at&per_page=100`)) as Json[];
    return notes.filter((note) => note['system'] !== true).map(toComment);
  }

  /** Changed files with line counts: /diffs (GitLab 15.7+), else the older /changes. */
  private async files(base: string): Promise<PullDetails['files']> {
    let diffs: Json[];
    try {
      diffs = (await this.request(`${base}/diffs?per_page=${PAGE}`)) as Json[];
    } catch {
      diffs = (((await this.request(`${base}/changes`).catch(() => ({}))) as Json)['changes'] as Json[] | undefined) ?? [];
    }
    return diffs.map((diff) => {
      const lines = str(diff['diff']).split('\n');
      return {
        path: str(diff['new_path']),
        status: diff['new_file'] ? 'added' : diff['deleted_file'] ? 'removed' : diff['renamed_file'] ? 'renamed' : 'modified',
        additions: lines.filter((line) => line.startsWith('+')).length,
        deletions: lines.filter((line) => line.startsWith('-')).length,
      };
    });
  }

  private async toPull(mr: Json): Promise<PullSummary> {
    const source = num(mr['source_project_id']);
    const fork = source && source !== num(mr['target_project_id']) ? await this.forkOf(source) : null;
    const state = str(mr['state']);
    return {
      number: num(mr['iid']),
      title: str(mr['title']),
      author: username(mr['author']),
      state: state === 'merged' ? 'merged' : state === 'opened' ? 'open' : 'closed',
      draft: mr['draft'] === true || mr['work_in_progress'] === true,
      head: str(mr['source_branch']),
      headRepo: fork ? fork.path || `project ${source}` : null,
      headCloneUrl: fork?.cloneUrl || null,
      base: str(mr['target_branch']),
      comments: num(mr['user_notes_count']),
      createdAt: str(mr['created_at']),
      updatedAt: str(mr['updated_at']),
      webUrl: str(mr['web_url']),
    };
  }

  /** A fork's path and clone URL (null when it is gone or hidden from the user). */
  private forkOf(id: number): Promise<{ path: string; cloneUrl: string } | null> {
    let found = this.projects.get(id);
    if (!found) {
      found = (this.request(`/projects/${id}`) as Promise<Json>).then(
        (repo) => ({ path: str(repo['path_with_namespace']), cloneUrl: str(repo['http_url_to_repo']) }),
        () => null,
      );
      this.projects.set(id, found);
    }
    return found;
  }

  private request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    return this.transport.request(path, method, body);
  }
}

function toIssue(issue: Json): IssueSummary {
  return {
    number: num(issue['iid']),
    title: str(issue['title']),
    author: username(issue['author']),
    state: str(issue['state']) === 'closed' ? 'closed' : 'open',
    // Objects with with_labels_details, names otherwise; colors are "#rrggbb".
    labels: (Array.isArray(issue['labels']) ? (issue['labels'] as unknown[]) : []).map((label) =>
      typeof label === 'string' ? { name: label, color: '' } : { name: str((label as Json)['name']), color: str((label as Json)['color']).replace(/^#/, '') },
    ),
    comments: num(issue['user_notes_count']),
    createdAt: str(issue['created_at']),
    updatedAt: str(issue['updated_at']),
    webUrl: str(issue['web_url']),
    isPull: false,
  };
}

const toComment = (note: Json): HostingComment => ({ id: num(note['id']), author: username(note['author']), body: str(note['body']), createdAt: str(note['created_at']) });
