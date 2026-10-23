// A small GitLab for tests: the /api/v4 endpoints Forklift uses (Bearer token; projects by URL-encoded path or
// id, merge requests and issues numbered separately, notes with system notes among them), and git over smart
// HTTP (basic auth with the user's name and token) for the repositories under `gitRoot`.
import { createServer } from 'node:http';
import { gitBackend } from './gitHttp.mjs';

const DAY = '2026-10-2';

export async function startGitLabMock({ token = 'tok-ada', user = 'ada', fullName = 'Ada Lovelace', gitRoot = null } = {}) {
  const requests = [];
  let base = '';
  let next = 10;
  const projects = [
    { id: 1, path_with_namespace: 'ada/demo', path: 'demo', namespace: { full_path: 'ada' }, visibility: 'private', description: 'demo repository', updated: 3 },
    { id: 2, path_with_namespace: 'eve/demo', path: 'demo', namespace: { full_path: 'eve' }, visibility: 'public', description: 'a fork', updated: 1 },
    { id: 3, path_with_namespace: 'team/tools/cli', path: 'cli', namespace: { full_path: 'team/tools' }, visibility: 'internal', description: 'in a subgroup', updated: 5 },
  ];
  const projectJson = (p) => ({
    ...p,
    default_branch: 'main',
    http_url_to_repo: `${base}/${p.path_with_namespace}.git`,
    ssh_url_to_repo: `git@127.0.0.1:${p.path_with_namespace}.git`,
    web_url: `${base}/${p.path_with_namespace}`,
    last_activity_at: `${DAY}${p.updated}T10:00:00Z`,
  });
  const notes = {
    'mr-1': [
      { id: 101, body: 'changed the description', author: { username: 'bob' }, system: true, created_at: `${DAY}1T08:00:00Z` },
      { id: 102, body: 'Looks good to me', author: { username: 'bob' }, system: false, created_at: `${DAY}1T09:00:00Z` },
    ],
  };
  const mrs = [
    { iid: 1, title: 'Add the feature', description: 'It adds **the feature**, closes #3.', author: { username: 'bob' }, state: 'opened', draft: false, has_conflicts: false, source_branch: 'feature', target_branch: 'main', source_project_id: 1, target_project_id: 1 },
    { iid: 2, title: 'Draft: Fix from a fork', description: '', author: { username: 'eve' }, state: 'opened', draft: true, has_conflicts: true, source_branch: 'fix', target_branch: 'main', source_project_id: 2, target_project_id: 1 },
    { iid: 5, title: 'Old change', description: '', author: { username: 'ada' }, state: 'merged', draft: false, source_branch: 'old', target_branch: 'main', source_project_id: 1, target_project_id: 1 },
    { iid: 6, title: 'Abandoned', description: '', author: { username: 'ada' }, state: 'closed', draft: false, source_branch: 'gone', target_branch: 'main', source_project_id: 1, target_project_id: 1 },
  ];
  const issues = [
    { iid: 3, title: 'Crash on start', description: 'It crashes. See !1.', author: { username: 'eve' }, state: 'opened', labels: [{ name: 'bug', color: '#ee0701' }] },
    { iid: 4, title: 'Closed idea', description: '', author: { username: 'ada' }, state: 'closed', labels: [] },
  ];
  const mrJson = (m) => ({ ...m, web_url: `${base}/ada/demo/-/merge_requests/${m.iid}`, user_notes_count: (notes[`mr-${m.iid}`] ?? []).filter((n) => !n.system).length, created_at: `${DAY}0T08:00:00Z`, updated_at: `${DAY}${m.iid}T08:00:00Z` });
  const issueJson = (i, details) => ({
    ...i,
    // Label objects only with with_labels_details=true.
    labels: details ? i.labels : i.labels.map((label) => label.name),
    web_url: `${base}/ada/demo/-/issues/${i.iid}`,
    user_notes_count: (notes[`issue-${i.iid}`] ?? []).length,
    created_at: `${DAY}0T08:00:00Z`,
    updated_at: `${DAY}${i.iid}T08:00:00Z`,
  });
  const byState = (list, state) => list.filter((item) => state === 'all' || item.state === (state ?? 'opened'));
  const findProject = (key) => projects.find((p) => String(p.id) === key || encodeURIComponent(p.path_with_namespace) === key);

  const P = '/projects/(ada%2Fdemo|1)';
  const routes = [
    ['GET', /^\/user$/, () => ({ username: user, name: fullName })],
    ['GET', /^\/projects$/, (_m, q) => (q.get('page') === '1' && q.get('membership') === 'true' ? [...projects].sort((a, b) => b.updated - a.updated).map(projectJson) : [])],
    ['GET', /^\/projects\/([^/]+)$/, (m) => findProject(m[1]) && projectJson(findProject(m[1]))],
    ['GET', new RegExp(`^${P}/merge_requests$`), (_m, q) => byState(mrs, q.get('state')).map(mrJson)],
    ['GET', new RegExp(`^${P}/merge_requests/(\\d+)$`), (m) => mrs.find((x) => x.iid === Number(m[2])) && mrJson(mrs.find((x) => x.iid === Number(m[2])))],
    ['GET', new RegExp(`^${P}/merge_requests/(\\d+)/commits$`), () => [{ id: 'a'.repeat(40), message: 'Add the feature\n\nDetails', author_name: 'Bob', authored_date: `${DAY}1T08:00:00Z` }]],
    ['GET', new RegExp(`^${P}/merge_requests/(\\d+)/diffs$`), () => [
      { new_path: 'src/feature.txt', new_file: true, deleted_file: false, renamed_file: false, diff: '@@ -0,0 +1,3 @@\n+one\n+two\n+three\n' },
      { new_path: 'README.md', new_file: false, deleted_file: false, renamed_file: false, diff: '@@ -1,2 +1,2 @@\n-old\n+new\n same\n' },
    ]],
    ['POST', new RegExp(`^${P}/merge_requests$`), (_m, _q, body) => {
      const created = { iid: next++, title: body.title, description: body.description, author: { username: user }, state: 'opened', draft: false, has_conflicts: false, source_branch: body.source_branch, target_branch: body.target_branch, source_project_id: 1, target_project_id: 1 };
      mrs.unshift(created);
      return mrJson(created);
    }],
    ['GET', new RegExp(`^${P}/issues$`), (_m, q) => byState(issues, q.get('state')).map((i) => issueJson(i, q.get('with_labels_details') === 'true'))],
    ['GET', new RegExp(`^${P}/issues/(\\d+)$`), (m) => issues.find((x) => x.iid === Number(m[2])) && issueJson(issues.find((x) => x.iid === Number(m[2])), false)],
    ['POST', new RegExp(`^${P}/issues$`), (_m, _q, body) => {
      const created = { iid: next++, title: body.title, description: body.description, author: { username: user }, state: 'opened', labels: [] };
      issues.unshift(created);
      return issueJson(created, true);
    }],
    ['GET', new RegExp(`^${P}/(merge_requests|issues)/(\\d+)/notes$`), (m) => notes[`${m[2] === 'issues' ? 'issue' : 'mr'}-${m[3]}`] ?? []],
    ['POST', new RegExp(`^${P}/(merge_requests|issues)/(\\d+)/notes$`), (m, _q, body) => {
      const note = { id: next++, body: body.body, author: { username: user }, system: false, created_at: `${DAY}3T12:00:00Z` };
      (notes[`${m[2] === 'issues' ? 'issue' : 'mr'}-${m[3]}`] ??= []).push(note);
      return note;
    }],
  ];

  const basic = `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/v4/')) {
      requests.push({ method: req.method, path: url.pathname, git: true, authorized: req.headers.authorization === basic });
      if (!gitRoot) return res.writeHead(404).end();
      if (req.headers.authorization !== basic) return res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="gitlab"' }).end();
      return gitBackend(req, res, gitRoot, user);
    }
    const path = url.pathname.slice('/api/v4'.length);
    requests.push({ method: req.method, path, authorized: req.headers.authorization === `Bearer ${token}`, accept: req.headers.accept });
    const send = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: '401 Unauthorized' });
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.method === 'POST' && 'title' in body && !String(body.title).trim()) return send(400, { message: { title: ["can't be blank"] } });
      for (const [method, pattern, handle] of routes) {
        const match = pattern.exec(path);
        if (!match || method !== req.method) continue;
        const result = handle(match, url.searchParams, body);
        return result ? send(method === 'POST' ? 201 : 200, result) : send(404, { message: '404 Not found' });
      }
      send(404, { error: '404 Not Found' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { url: base, requests, mrs, issues, notes, close: () => new Promise((resolve) => server.close(resolve)) };
}
