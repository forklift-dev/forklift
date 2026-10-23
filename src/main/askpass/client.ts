import { connect } from 'node:net';
import { SOCKET_ENV, TOKEN_ENV, type AskRequest, type AskResponse, type CredentialAction } from './protocol';

/**
 * The `--forklift-askpass` mode: git or ssh ran us with a prompt; ask the running app over its socket and
 * print the answer. Resolves to the exit code (non-zero: cancelled or no app to ask).
 */
export async function runAskpassClient(prompt: string, env: NodeJS.ProcessEnv, output: (text: string) => void): Promise<number> {
  const token = env[TOKEN_ENV];
  if (!token) return 2;
  const response = await request(env, { token, prompt });
  if (!response) return 3;
  if ('answer' in response) {
    output(`${response.answer}\n`);
    return 0;
  }
  return 1;
}

/**
 * The credential helper mode (`--forklift-askpass credential get|store|erase`): git's fields come on stdin;
 * for `get`, what the app has goes to stdout. Always exits 0: git then asks the next helper or the user.
 */
export async function runCredentialClient(action: string, input: string, env: NodeJS.ProcessEnv, output: (text: string) => void): Promise<number> {
  const token = env[TOKEN_ENV];
  if (!token || (action !== 'get' && action !== 'store' && action !== 'erase')) return 0;
  const fields: Record<string, string> = {};
  for (const line of input.split('\n')) {
    if (!line) break;
    const equals = line.indexOf('=');
    if (equals > 0) fields[line.slice(0, equals)] = line.slice(equals + 1);
  }
  const response = await request(env, { token, credential: { action: action as CredentialAction, fields } });
  if (response && 'fields' in response) {
    const lines = Object.entries(response.fields).filter(([key, value]) => /^[a-z]+$/.test(key) && !/[\n\0]/.test(value));
    if (lines.length) output(`${lines.map(([key, value]) => `${key}=${value}`).join('\n')}\n\n`);
  }
  return 0;
}

/** Sends one request to the app; resolves to its answer, or null when there is no app to ask. */
function request(env: NodeJS.ProcessEnv, message: AskRequest): Promise<AskResponse | null> {
  const socket = env[SOCKET_ENV];
  if (!socket) return Promise.resolve(null);
  return new Promise((resolve) => {
    let buffer = '';
    const connection = connect(socket, () => connection.write(`${JSON.stringify(message)}\n`));
    connection.setEncoding('utf8');
    connection.on('data', (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      connection.end();
      try {
        resolve(JSON.parse(buffer.slice(0, end)) as AskResponse);
      } catch {
        // malformed: treat as cancelled
        resolve({ cancel: true });
      }
    });
    connection.on('error', () => resolve(null));
    connection.on('close', () => resolve({ cancel: true }));
  });
}
