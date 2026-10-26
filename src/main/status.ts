import { basename } from 'node:path';
import { maskCredentials } from '../shared/log';
import type { RunningCommand } from '../shared/state';
import { withoutHelper } from './log/operationLog';
import type { RunningProcess } from './process/runner';

/** Only git commands belong in the status popover; their credentials and private helper path stay hidden. */
export function runningGitCommands(running: readonly RunningProcess[], executable: string): RunningCommand[] {
  const wanted = basename(executable).toLowerCase();
  return running
    .filter((process) => {
      const actual = basename(process.command).toLowerCase();
      return process.command === executable || actual === wanted || (wanted === 'git' && actual === 'git.exe');
    })
    .map((process) => ({
      id: process.id,
      title: maskCredentials([basename(process.command), ...withoutHelper(process.args)].join(' ')),
      startedAt: process.startedAt,
    }));
}

/** Electron reports working-set sizes in KiB. */
export function applicationMemory(metrics: ReadonlyArray<{ memory: { workingSetSize: number } }>): number {
  return metrics.reduce((bytes, metric) => bytes + metric.memory.workingSetSize * 1024, 0);
}
