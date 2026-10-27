import { isAbsolute, resolve } from 'node:path';

export type ToolMode =
  | { kind: 'diff'; local: string; remote: string; path?: string }
  | { kind: 'merge'; base: string; local: string; remote: string; merged: string };

/** Parses arguments after the `difftool` or `mergetool` command name. */
export function parseToolMode(args: readonly string[], cwd = process.cwd()): ToolMode {
  const kind = args[0];
  if (kind !== 'difftool' && kind !== 'mergetool') throw new TypeError('expected difftool or mergetool');
  const accepted = kind === 'difftool' ? ['--local', '--remote', '--path'] : ['--base', '--local', '--remote', '--merged'];
  const options = new Map<string, string>();
  for (let index = 1; index < args.length; index++) {
    const flag = args[index]!;
    if (!accepted.includes(flag)) throw new TypeError(`unknown ${kind} argument: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new TypeError(`${flag} requires a path`);
    if (options.has(flag)) throw new TypeError(`${flag} may be specified only once`);
    options.set(flag, value);
  }
  const required = kind === 'difftool' ? ['--local', '--remote'] : ['--base', '--local', '--remote', '--merged'];
  for (const flag of required) if (!options.has(flag)) throw new TypeError(`missing ${flag}`);
  for (const [flag, path] of options) {
    if (path.includes('\0')) throw new TypeError(`${flag} contains a NUL byte`);
    options.set(flag, isAbsolute(path) ? path : resolve(cwd, path));
  }
  if (kind === 'difftool') {
    const path = options.get('--path');
    return { kind: 'diff', local: options.get('--local')!, remote: options.get('--remote')!, ...(path && { path }) };
  }
  return { kind: 'merge', base: options.get('--base')!, local: options.get('--local')!, remote: options.get('--remote')!, merged: options.get('--merged')! };
}
