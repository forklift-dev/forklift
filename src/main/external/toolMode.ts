import { isAbsolute, resolve } from 'node:path';

export type ToolMode =
  | { kind: 'diff'; local: string; remote: string; path?: string }
  | { kind: 'merge'; base: string | null; local: string; remote: string; merged: string };

function resolvePath(path: string, cwd: string): string {
  if (path.includes('\0')) throw new TypeError('path contains a NUL byte');
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/** KDiff3 and Meld positional forms used by Git's built-in mergetool definitions. */
function parsePositionalMerge(args: readonly string[], cwd: string): ToolMode {
  const files: string[] = [];
  let merged: string | null = null;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--auto' || arg === '--auto-merge') continue;
    if (arg === '--L1' || arg === '--L2' || arg === '--L3') {
      if (!args[++index]) throw new TypeError(`${arg} requires a label`);
      continue;
    }
    if (arg === '-o' || arg === '--output') {
      merged = args[++index] ?? null;
      if (!merged) throw new TypeError(`${arg} requires a path`);
      continue;
    }
    if (arg.startsWith('--output=')) {
      merged = arg.slice('--output='.length);
      if (!merged) throw new TypeError('--output requires a path');
      continue;
    }
    if (arg.startsWith('-')) throw new TypeError(`unknown mergetool argument: ${arg}`);
    files.push(arg);
  }
  if (merged) {
    if (files.length === 3) {
      const meldOrder = args.some((arg) => arg === '--output' || arg.startsWith('--output='));
      return {
        kind: 'merge',
        base: resolvePath(files[meldOrder ? 1 : 0]!, cwd),
        local: resolvePath(files[meldOrder ? 0 : 1]!, cwd),
        remote: resolvePath(files[2]!, cwd),
        merged: resolvePath(merged, cwd),
      };
    }
    if (files.length === 2) return { kind: 'merge', base: null, local: resolvePath(files[0]!, cwd), remote: resolvePath(files[1]!, cwd), merged: resolvePath(merged, cwd) };
  } else if (files.length === 3) {
    // Older Meld: LOCAL MERGED REMOTE.
    return { kind: 'merge', base: null, local: resolvePath(files[0]!, cwd), remote: resolvePath(files[2]!, cwd), merged: resolvePath(files[1]!, cwd) };
  }
  throw new TypeError('unsupported positional mergetool arguments');
}

/** Parses arguments after the `difftool` or `mergetool` command name. */
export function parseToolMode(args: readonly string[], cwd = process.cwd()): ToolMode {
  const kind = args[0];
  if (kind !== 'difftool' && kind !== 'mergetool') throw new TypeError('expected difftool or mergetool');
  if (kind === 'mergetool' && !args.includes('--base') && !args.includes('--local')) return parsePositionalMerge(args, cwd);
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
    options.set(flag, resolvePath(path, cwd));
  }
  if (kind === 'difftool') {
    const path = options.get('--path');
    return { kind: 'diff', local: options.get('--local')!, remote: options.get('--remote')!, ...(path && { path }) };
  }
  return { kind: 'merge', base: options.get('--base')!, local: options.get('--local')!, remote: options.get('--remote')!, merged: options.get('--merged')! };
}
