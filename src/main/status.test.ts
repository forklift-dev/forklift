import { describe, expect, it } from 'vitest';
import { applicationMemory, runningGitCommands } from './status';

describe('status data', () => {
  it('keeps only the configured git executable and masks private arguments', () => {
    const running = [
      { id: 1, command: '/usr/bin/git', args: ['-c', 'credential.helper=!node /tmp/forklift-askpass.js', 'fetch', 'https://ada:secret@example.com/repo'], cwd: '/repo', startedAt: 10 },
      { id: 2, command: 'node', args: ['build.js'], startedAt: 20 },
    ];
    expect(runningGitCommands(running, '/usr/bin/git')).toEqual([
      { id: 1, title: 'git fetch https://ada:***@example.com/repo', startedAt: 10 },
    ]);
  });

  it('sums Electron process working sets and converts KiB to bytes', () => {
    expect(applicationMemory([{ memory: { workingSetSize: 1024 } }, { memory: { workingSetSize: 512 } }])).toBe(1536 * 1024);
  });
});
