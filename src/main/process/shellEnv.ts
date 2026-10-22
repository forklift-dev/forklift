import { randomUUID } from 'node:crypto';
import { homedir, userInfo } from 'node:os';
import { basename } from 'node:path';
import type { Env } from '../../shared/process';

/** Minimal process-running contract, so resolution is testable without Electron. */
export type RunText = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env: Env; timeoutMs: number },
) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;

/** Exported into the shell so rc files can skip slow interactive setup while we resolve. */
export const RESOLVING_FLAG = 'FORKLIFT_RESOLVING_ENVIRONMENT';
const DEFAULT_TIMEOUT_MS = 10_000;

// Variables the resolving shell sets for itself; meaningless for the programs we start.
const SHELL_LOCAL_KEYS = new Set(['_', 'SHLVL', 'PWD', 'OLDPWD', RESOLVING_FLAG]);

/**
 * GUI apps started from the Dock (macOS) or a desktop menu (Linux) do not get the PATH and
 * variables users set up in their shell rc files. Launched from a terminal, the env is complete.
 * `FORKLIFT_SHELL_ENV=force|off` overrides the heuristic.
 */
export function shouldResolveShellEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, startedFromTerminal: boolean): boolean {
  const override = env['FORKLIFT_SHELL_ENV'];
  if (override === 'force') return true;
  if (override === 'off') return false;
  return platform !== 'win32' && !startedFromTerminal;
}

export function userShell(env: NodeJS.ProcessEnv | Env, platform: NodeJS.Platform): string {
  if (env['SHELL']) return env['SHELL'];
  try {
    const { shell } = userInfo();
    if (shell) return shell;
  } catch {}
  return platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
}

/** Arguments for an interactive login shell running `script`, or null for shells we cannot drive. */
export function shellArgs(shell: string, script: string): string[] | null {
  const name = basename(shell).replace(/\.exe$/, '');
  if (name === 'csh' || name === 'tcsh') return ['-ic', script]; // csh accepts -l only on its own
  if (['nu', 'xonsh', 'pwsh', 'powershell', 'elvish'].includes(name)) return null; // non-POSIX syntax
  return ['-i', '-l', '-c', script];
}

/** Extracts `env -0` output printed between two markers; rc files may print anything around it. */
export function parseEnvBlock(output: string, marker: string): Env | null {
  const start = output.indexOf(marker);
  const end = output.lastIndexOf(marker);
  if (start < 0 || end <= start) return null;

  const env: Env = {};
  for (const entry of output.slice(start + marker.length, end).split('\0')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const key = entry.slice(0, eq);
    if (!SHELL_LOCAL_KEYS.has(key)) env[key] = entry.slice(eq + 1);
  }
  // Without PATH the result would break every lookup; treat it as a failed resolution.
  return env['PATH'] ? env : null;
}

export interface ResolveOptions {
  /** Environment the shell starts from (the app's own, already sanitized). */
  env: Env;
  platform?: NodeJS.Platform;
  shell?: string;
  timeoutMs?: number;
  log?: (message: string) => void;
}

/** Runs the user's login shell once and returns the environment it ends up with, or null on failure. */
export async function resolveShellEnv(run: RunText, options: ResolveOptions): Promise<Env | null> {
  const log = options.log ?? (() => {});
  const shell = options.shell ?? userShell(options.env, options.platform ?? process.platform);
  const marker = `__FORKLIFT_ENV_${randomUUID().replaceAll('-', '')}__`;
  const args = shellArgs(shell, `printf '%s' ${marker}; /usr/bin/env -0; printf '%s' ${marker}`);
  if (!args) {
    log(`shell env: ${shell} is not supported, using the app environment`);
    return null;
  }

  const startedAt = Date.now();
  try {
    const result = await run(shell, args, {
      cwd: options.env['HOME'] ?? homedir(),
      env: { ...options.env, [RESOLVING_FLAG]: '1' },
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    if (result.timedOut) {
      log(`shell env: ${shell} did not finish in time, using the app environment`);
      return null;
    }
    // A non-zero exit (an rc file error) still prints a usable environment, so parse regardless.
    const env = parseEnvBlock(result.stdout, marker);
    if (!env) {
      log(`shell env: no environment in ${shell} output (exit ${result.code}): ${result.stderr.trim().slice(0, 500)}`);
      return null;
    }
    log(`shell env: resolved from ${shell} in ${Date.now() - startedAt} ms`);
    return env;
  } catch (error) {
    log(`shell env: failed to run ${shell}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
