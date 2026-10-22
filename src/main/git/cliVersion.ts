import type { ProcessRunner } from '../process/runner';

/** Returns e.g. "2.53.0", or null when no usable git CLI is found. */
export async function detectGitVersion(runner: ProcessRunner): Promise<string | null> {
  try {
    const { code, stdout } = await runner.run('git', ['--version'], { timeoutMs: 10_000 });
    if (code !== 0) return null;
    // "git version 2.53.0", "git version 2.47.1.windows.2", "git version 2.39.5 (Apple Git-154)"
    return /git version (\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null;
  } catch {
    return null;
  }
}
