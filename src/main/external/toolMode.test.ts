import { describe, expect, it } from 'vitest';
import { parseToolMode } from './toolMode';

describe('parseToolMode', () => {
  it('parses a difftool invocation with spaces in paths', () => {
    expect(parseToolMode(['difftool', '--local', '/tmp/old file', '--remote', '/tmp/new file', '--path', '/repo/a file.ts'])).toEqual({
      kind: 'diff', local: '/tmp/old file', remote: '/tmp/new file', path: '/repo/a file.ts',
    });
  });

  it('parses all four mergetool paths', () => {
    expect(parseToolMode(['mergetool', '--base', '/tmp/base', '--local', '/tmp/ours', '--remote', '/tmp/theirs', '--merged', '/repo/result'])).toEqual({
      kind: 'merge', base: '/tmp/base', local: '/tmp/ours', remote: '/tmp/theirs', merged: '/repo/result',
    });
  });

  it.each([
    [['difftool', '--local', '/tmp/a'], 'missing --remote'],
    [['difftool', '--local', 'relative', '--remote', '/tmp/b'], '--local must be an absolute path'],
    [['difftool', '--local', '/tmp/a', '--local', '/tmp/b', '--remote', '/tmp/c'], '--local may be specified only once'],
    [['mergetool', '--base', '/tmp/a', '--local', '/tmp/b', '--remote', '/tmp/c'], 'missing --merged'],
    [['mergetool', '--base', '/tmp/a', '--local', '/tmp/b', '--remote', '/tmp/c', '--merged', '/tmp/out', '--path', '/tmp/x'], 'unknown mergetool argument: --path'],
    [['tool', '--local', '/tmp/a'], 'expected difftool or mergetool'],
  ] as const)('rejects malformed args %j', (args, message) => {
    expect(() => parseToolMode(args)).toThrow(message);
  });
});
