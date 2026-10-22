import { spawn } from 'node:child_process';

/** Time a process tree gets to exit after SIGTERM before it is SIGKILLed. */
export const KILL_GRACE_MS = 2000;

/**
 * Terminates a process and everything it started (git spawns ssh, credential helpers, hooks).
 * POSIX: processes are spawned as group leaders (`detached: true`), so the whole group is
 * signalled. Windows: no group signals; `taskkill /T` walks the tree, `/F` because console
 * programs ignore polite close requests.
 */
export function killTree(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch (error) {
    // ESRCH: the group is already gone. Fall back to the single process for anything else.
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      try {
        process.kill(pid, signal);
      } catch {}
    }
  }
}

/**
 * SIGTERM now, SIGKILL after the grace period. The follow-up is unconditional: children can
 * ignore SIGTERM or outlive the group leader, and signalling an empty group is a no-op (ESRCH).
 */
export function terminateTree(pid: number): void {
  killTree(pid, 'SIGTERM');
  if (process.platform === 'win32') return; // taskkill /F is already final
  setTimeout(() => killTree(pid, 'SIGKILL'), KILL_GRACE_MS).unref();
}
