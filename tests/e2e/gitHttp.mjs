// A git smart-HTTP server for tests: `git http-backend` behind HTTP basic auth, on a random local port.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

export async function startGitHttpServer(projectRoot, { user, password }) {
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ method: req.method, path: url.pathname, authorized: req.headers.authorization === expected });
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="forklift-test"' });
      return res.end('Unauthorized');
    }
    const backend = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: projectRoot,
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method,
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        REMOTE_USER: user,
        REMOTE_ADDR: '127.0.0.1',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
    req.pipe(backend.stdin);
    let head = Buffer.alloc(0);
    let headersDone = false;
    backend.stdout.on('data', (chunk) => {
      if (headersDone) return res.write(chunk);
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      headersDone = true;
      const headers = {};
      let status = 200;
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const [name, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
        else headers[name] = value;
      }
      res.writeHead(status, headers);
      res.write(head.subarray(end + 4));
    });
    backend.on('close', () => res.end());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
