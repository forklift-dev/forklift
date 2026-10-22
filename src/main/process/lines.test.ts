import { describe, expect, it } from 'vitest';
import { createLineSplitter } from './lines';

function split(chunks: string[]): string[] {
  const lines: string[] = [];
  const splitter = createLineSplitter((line) => lines.push(line));
  for (const chunk of chunks) splitter.push(chunk);
  splitter.flush();
  return lines;
}

describe('createLineSplitter', () => {
  it('splits on \\n, \\r\\n and \\r across chunk boundaries', () => {
    expect(split(['one\ntw', 'o\r\nthree\rfour'])).toEqual(['one', 'two', 'three', 'four']);
  });

  it('treats progress redraws as separate updates', () => {
    expect(split(['Receiving objects:  10%\r', 'Receiving objects:  55%\r', 'Receiving objects: 100%, done.\n'])).toEqual([
      'Receiving objects:  10%',
      'Receiving objects:  55%',
      'Receiving objects: 100%, done.',
    ]);
  });

  it('does not invent an empty line when \\r\\n is split between chunks', () => {
    expect(split(['a\r', '\nb'])).toEqual(['a', 'b']);
  });

  it('flushes an unterminated last line once', () => {
    expect(split(['tail'])).toEqual(['tail']);
    expect(split(['x\n'])).toEqual(['x']);
  });
});
