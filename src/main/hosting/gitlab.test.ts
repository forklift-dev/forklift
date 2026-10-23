import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startGitLabMock, type GitLabMock } from '../../../tests/e2e/gitlabMock.mjs';
import { matchRemote, type HostingAccount } from '../../shared/hosting';
import type { Fetch } from './api';
import { GitLabClient } from './gitlab';

const fetch: Fetch = (url, init) => globalThis.fetch(url, init);

let mock: GitLabMock;
let client: GitLabClient;
beforeEach(async () => {
  mock = await startGitLabMock();
  client = new GitLabClient(mock.url, 'tok-ada', fetch);
});
afterEach(() => mock.close());

describe('GitLabClient', () => {
  it('reads the user and the projects (subgroups too), with Bearer on /api/v4', async () => {
    expect(await client.user()).toEqual({ login: 'ada', name: 'Ada Lovelace' });
    const repos = await client.repos();
    expect(repos.map((repo) => [repo.fullName, repo.owner, repo.name, repo.private])).toEqual([
      ['team/tools/cli', 'team/tools', 'cli', true],
      ['ada/demo', 'ada', 'demo', true],
      ['eve/demo', 'eve', 'demo', false],
    ]);
    expect(repos[1]?.cloneUrl).toBe(`${mock.url}/ada/demo.git`);
    expect(await client.repo('ada', 'demo')).toEqual({ defaultBranch: 'main', webUrl: `${mock.url}/ada/demo` });
    expect(mock.requests.every((request) => request.authorized && request.path.startsWith('/'))).toBe(true);
  });

  it('lists merge requests by state, naming forks', async () => {
    const open = await client.pulls('ada', 'demo', 'open');
    expect(open.map((mr) => [mr.number, mr.state, mr.draft, mr.head, mr.headRepo, mr.headCloneUrl])).toEqual([
      [1, 'open', false, 'feature', null, null],
      [2, 'open', true, 'fix', 'eve/demo', `${mock.url}/eve/demo.git`],
    ]);
    // Closed includes merged ones, as elsewhere.
    expect((await client.pulls('ada', 'demo', 'closed')).map((mr) => [mr.number, mr.state])).toEqual([
      [5, 'merged'],
      [6, 'closed'],
    ]);
    expect(client.pullRef(2)).toBe('refs/merge-requests/2/head');
  });

  it('reads a merge request: description, commits, files with line counts, comments without system notes', async () => {
    const mr = await client.pull('ada', 'demo', 1);
    expect(mr).toMatchObject({ body: 'It adds **the feature**, closes #3.', mergeable: true, comments: 1 });
    expect(mr.files).toEqual([
      { path: 'src/feature.txt', status: 'added', additions: 3, deletions: 0 },
      { path: 'README.md', status: 'modified', additions: 1, deletions: 1 },
    ]);
    expect(mr.commits[0]).toMatchObject({ sha: 'a'.repeat(40), author: 'Bob' });
    expect(mr.discussion.map((note) => note.body)).toEqual(['Looks good to me']);
    expect((await client.pull('ada', 'demo', 2)).mergeable).toBe(false);
  });

  it('reads issues with label colors', async () => {
    expect((await client.issues('ada', 'demo', 'open')).map((issue) => [issue.number, issue.labels, issue.isPull])).toEqual([[3, [{ name: 'bug', color: 'ee0701' }], false]]);
    expect((await client.issues('ada', 'demo', 'all')).map((issue) => issue.number)).toEqual([3, 4]);
    expect(await client.issue('ada', 'demo', 3)).toMatchObject({ body: 'It crashes. See !1.', labels: [{ name: 'bug', color: '' }], discussion: [] });
  });

  it('creates merge requests, issues and comments on the right kind', async () => {
    const mr = await client.createPull('ada', 'demo', { head: 'topic', base: 'main', title: 'Topic', body: 'Why' });
    expect(mr).toMatchObject({ head: 'topic', base: 'main', state: 'open', author: 'ada' });
    expect(mock.mrs[0]).toMatchObject({ source_branch: 'topic', target_branch: 'main', description: 'Why' });
    const issue = await client.createIssue('ada', 'demo', { title: 'New bug', body: 'Steps' });
    expect(mock.issues[0]).toMatchObject({ iid: issue.number, description: 'Steps' });
    await client.comment('ada', 'demo', 'pull', 1, 'On the MR');
    await client.comment('ada', 'demo', 'issue', 3, 'On the issue');
    expect(mock.notes['mr-1']?.at(-1)?.['body']).toBe('On the MR');
    expect(mock.notes['issue-3']?.[0]?.['body']).toBe('On the issue');
  });

  it('explains failures in GitLab’s formats', async () => {
    await expect(new GitLabClient(mock.url, 'wrong', fetch).user()).rejects.toThrow(/refused the token/);
    await expect(client.pull('ada', 'demo', 99)).rejects.toThrow(/Not found on the server: 404 Not found/);
    await expect(client.createIssue('ada', 'demo', { title: ' ', body: '' })).rejects.toThrow(/title can't be blank/);
  });

  it('addresses projects in subgroups by their encoded path', async () => {
    const seen: string[] = [];
    const record: Fetch = async (url) => {
      seen.push(url);
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => '{"default_branch":"dev","web_url":"w"}' };
    };
    await new GitLabClient('https://gitlab.com', 't', record).repo('team/tools', 'cli');
    expect(seen).toEqual(['https://gitlab.com/api/v4/projects/team%2Ftools%2Fcli']);
  });
});

describe('matchRemote on GitLab', () => {
  const account: HostingAccount = { id: 'g', provider: 'gitlab', url: 'https://gitlab.com', username: 'ada', name: 'Ada' };
  it('accepts subgroups (owner is the whole group path)', () => {
    expect(matchRemote(account, 'git@gitlab.com:team/tools/cli.git')).toEqual({ owner: 'team/tools', name: 'cli' });
    expect(matchRemote(account, 'https://gitlab.com/ada/demo.git')).toEqual({ owner: 'ada', name: 'demo' });
  });
  it('other services keep owner/name only', () => {
    expect(matchRemote({ ...account, provider: 'github', url: 'https://github.com' }, 'git@github.com:a/b/c.git')).toBeNull();
  });
});
