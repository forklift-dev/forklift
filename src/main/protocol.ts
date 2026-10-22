import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { protocol } from 'electron';
import { APP_HOST, APP_SCHEME } from './origin';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  ]);
}

/** Serves the built renderer from `rendererDir`, refusing anything outside it. */
export function handleAppProtocol(rendererDir: string): void {
  const base = resolve(rendererDir);
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });

    const filePath = resolve(base, `.${decodeURIComponent(url.pathname)}`);
    if (!filePath.startsWith(base + sep)) return new Response('Forbidden', { status: 403 });

    try {
      const body = await readFile(filePath);
      const type = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      return new Response(new Uint8Array(body), { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
