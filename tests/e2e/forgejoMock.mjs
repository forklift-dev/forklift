// A small Forgejo for tests: the /api/v1 endpoints Forklift uses (token auth), and git over smart HTTP
// (basic auth with the user's name and token) for the repositories under `gitRoot`. `flavor: 'gitverse'`
// answers like GitVerse instead: the API under /api, Bearer tokens, the version in Accept, errors as
// {"error": {...}}, and issue lists that include pull requests.
import { createServer } from 'node:http';
import { gitBackend } from './gitHttp.mjs';

const DAY = '2026-10-2';

export async function startForgejoMock({ token = 'tok-ada', user = 'ada', fullName = 'Ada Lovelace', gitRoot = null, flavor = 'forgejo' } = {}) {
  const gitverse = flavor === 'gitverse';
  const prefix = gitverse ? '/api' : '/api/v1';
  const authorization = gitverse ? `Bearer ${token}` : `token ${token}`;
  const requests = [];
  let base = '';
  const repo = (owner, name, updated) => ({
    full_name: `${owner}/${name}`,
    name,
    owner: { login: owner },
    description: `${name} repository`,
    private: name === 'secret',
    clone_url: `${base}/${owner}/${name}.git`,
    ssh_url: `git@127.0.0.1:${owner}/${name}.git`,
    html_url: `${base}/${owner}/${name}`,
    default_branch: 'main',
    updated_at: `${DAY}${updated}T10:00:00Z`,
  });
  const comments = {
    1: [{ id: 11, user: { login: 'bob' }, body: 'Looks good to me', created_at: `${DAY}1T09:00:00Z` }],
    3: [],
  };
  const pulls = [
    { number: 1, title: 'Add the feature', body: 'It adds **the feature**.', user: { login: 'bob' }, state: 'open', merged: false, mergeable: true, head: { ref: 'feature', repo: { full_name: 'ada/demo' } }, base: { ref: 'main' } },
    { number: 2, title: 'WIP: Fix from a fork', body: '', user: { login: 'eve' }, state: 'open', merged: false, mergeable: null, head: { ref: 'fix', repo: { full_name: 'eve/demo', clone_url: '' } }, base: { ref: 'main' } },
    { number: 5, title: 'Old change', body: '', user: { login: 'ada' }, state: 'closed', merged: true, head: { ref: 'old', repo: { full_name: 'ada/demo' } }, base: { ref: 'main' } },
  ];
  const issues = [
    { number: 3, title: 'Crash on start', body: 'It crashes.', user: { login: 'eve' }, state: 'open', labels: [{ name: 'bug', color: 'ee0701' }] },
    { number: 4, title: 'Closed idea', body: '', user: { login: 'ada' }, state: 'closed', labels: [] },
  ];
  let next = 6;
  const pullJson = (p) => ({ ...p, head: { ...p.head, repo: { ...p.head.repo, clone_url: `${base}/${p.head.repo.full_name}.git` } }, html_url: `${base}/ada/demo/pulls/${p.number}`, comments: (comments[p.number] ?? []).length, created_at: `${DAY}0T08:00:00Z`, updated_at: `${DAY}${p.number}T08:00:00Z` });
  const issueJson = (i) => ({ ...i, html_url: `${base}/ada/demo/issues/${i.number}`, comments: (comments[i.number] ?? []).length, created_at: `${DAY}0T08:00:00Z`, updated_at: `${DAY}${i.number}T08:00:00Z` });
  const byState = (list, state) => list.filter((item) => state === 'all' || item.state === (state ?? 'open'));

  const routes = [
    ['GET', /^\/user$/, () => ({ login: user, full_name: fullName })],
    ['GET', /^\/user\/repos$/, (_m, q) => (q.get('page') === '1' ? [repo('ada', 'demo', 3), repo('ada', 'secret', 5), repo('team', 'tools', 1)] : [])],
    ['GET', /^\/repos\/ada\/demo$/, () => repo('ada', 'demo', 3)],
    ['GET', /^\/repos\/ada\/demo\/pulls$/, (_m, q) => byState(pulls, q.get('state')).map(pullJson)],
    ['GET', /^\/repos\/ada\/demo\/pulls\/(\d+)$/, (m) => pulls.find((p) => p.number === Number(m[1])) && pullJson(pulls.find((p) => p.number === Number(m[1])))],
    ['GET', /^\/repos\/ada\/demo\/pulls\/(\d+)\/commits$/, () => [{ sha: 'a'.repeat(40), commit: { message: 'Add the feature\n\nDetails', author: { name: 'Bob', date: `${DAY}1T08:00:00Z` } } }]],
    ['GET', /^\/repos\/ada\/demo\/pulls\/(\d+)\/files$/, () => [{ filename: 'src/feature.txt', status: 'added', additions: 3, deletions: 0 }]],
    ['POST', /^\/repos\/ada\/demo\/pulls$/, (_m, _q, body) => {
      const created = { number: next++, title: body.title, body: body.body, user: { login: user }, state: 'open', merged: false, mergeable: true, head: { ref: body.head, repo: { full_name: 'ada/demo' } }, base: { ref: body.base } };
      pulls.unshift(created);
      return pullJson(created);
    }],
    ['GET', /^\/repos\/ada\/demo\/issues$/, (_m, q) => [
      ...byState(issues, q.get('state')).map(issueJson),
      // GitVerse has no type filter here: pull requests come too.
      ...(gitverse ? byState(pulls, q.get('state')).map((p) => ({ ...issueJson({ ...p, labels: [] }), pull_request: { merged: p.merged } })) : []),
    ]],
    ['GET', /^\/repos\/ada\/demo\/issues\/(\d+)$/, (m) => {
      const found = issues.find((i) => i.number === Number(m[1]));
      if (found) return issueJson(found);
      const pull = pulls.find((p) => p.number === Number(m[1]));
      return pull && { ...pullJson(pull), pull_request: { merged: pull.merged } };
    }],
    ['POST', /^\/repos\/ada\/demo\/issues$/, (_m, _q, body) => {
      const created = { number: next++, title: body.title, body: body.body, user: { login: user }, state: 'open', labels: [] };
      issues.unshift(created);
      return issueJson(created);
    }],
    ['GET', /^\/repos\/ada\/demo\/issues\/(\d+)\/comments$/, (m) => comments[m[1]] ?? []],
    ['POST', /^\/repos\/ada\/demo\/issues\/(\d+)\/comments$/, (m, _q, body) => {
      const comment = { id: next++, user: { login: user }, body: body.body, created_at: `${DAY}3T12:00:00Z` };
      (comments[m[1]] ??= []).push(comment);
      return comment;
    }],
  ];

  const basic = `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(`${prefix}/`)) {
      requests.push({ method: req.method, path: url.pathname, git: true, authorized: req.headers.authorization === basic });
      if (!gitRoot) return res.writeHead(404).end();
      if (req.headers.authorization !== basic) return res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="forgejo"' }).end();
      return gitBackend(req, res, gitRoot, user);
    }
    const path = url.pathname.slice(prefix.length);
    requests.push({ method: req.method, path, authorized: req.headers.authorization === authorization, accept: req.headers.accept });
    const send = (status, data) =>
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(gitverse && status >= 400 ? { error: { code: 'ERROR', message: data.message, status } } : data));
    if (req.headers.authorization !== authorization) return send(401, { message: 'token is required' });
    if (gitverse && req.headers.accept !== 'application/vnd.gitverse.object+json;version=1') return send(400, { message: 'The request format is invalid' });
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      for (const [method, pattern, handle] of routes) {
        const match = pattern.exec(path);
        if (!match || method !== req.method) continue;
        const result = handle(match, url.searchParams, raw ? JSON.parse(raw) : {});
        return result ? send(method === 'POST' ? 201 : 200, result) : send(404, { message: 'The target couldn\'t be found.' });
      }
      send(404, { message: 'not found' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return { url: base, requests, pulls, issues, comments, close: () => new Promise((resolve) => server.close(resolve)) };
}
