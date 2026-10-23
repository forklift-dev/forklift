import { connect } from 'node:net';
import { SOCKET_ENV, TOKEN_ENV, type AskResponse } from './protocol';

/**
 * The `--forklift-askpass` mode: git or ssh ran us with a prompt; ask the running app over its socket and
 * print the answer. Resolves to the exit code (non-zero: cancelled or no app to ask).
 */
export function runAskpassClient(prompt: string, env: NodeJS.ProcessEnv, output: (text: string) => void): Promise<number> {
  const socket = env[SOCKET_ENV];
  const token = env[TOKEN_ENV];
  if (!socket || !token) return Promise.resolve(2);
  return new Promise((resolve) => {
    let buffer = '';
    const connection = connect(socket, () => connection.write(`${JSON.stringify({ token, prompt })}\n`));
    connection.setEncoding('utf8');
    connection.on('data', (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      connection.end();
      try {
        const response = JSON.parse(buffer.slice(0, end)) as AskResponse;
        if ('answer' in response) {
          output(`${response.answer}\n`);
          return resolve(0);
        }
      } catch {
        // malformed: treat as cancelled
      }
      resolve(1);
    });
    connection.on('error', () => resolve(3));
    connection.on('close', () => resolve(1));
  });
}
