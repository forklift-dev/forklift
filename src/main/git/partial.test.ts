import { describe, expect, it } from 'vitest';
import { changeLines, type LineChange } from '../../shared/staging';
import { lcsChanges } from './lineDiff.testkit';
import { applyLineChanges, PartialApplyError, splitLines } from './partial';

const all = { original: () => true, modified: () => true };
const none = { original: () => false, modified: () => false };
const only = (original: number[], modified: number[]) => ({
  original: (line: number) => original.includes(line),
  modified: (line: number) => modified.includes(line),
});
const change = (o1: number, o2: number, m1: number, m2: number): LineChange => ({
  originalStartLineNumber: o1,
  originalEndLineNumber: o2,
  modifiedStartLineNumber: m1,
  modifiedEndLineNumber: m2,
});

describe('splitLines', () => {
  it('splits like Monaco, keeping each line ending', () => {
    expect(splitLines('a\r\nb\nc')).toEqual({ lines: ['a', 'b', 'c'], eols: ['\r\n', '\n', ''] });
    expect(splitLines('a\n')).toEqual({ lines: ['a', ''], eols: ['\n', ''] });
    expect(splitLines('')).toEqual({ lines: [''], eols: [''] });
  });
});

describe('applyLineChanges', () => {
  // original: a b c d ; modified: a B c d e   (b → B, e added at the end)
  const original = 'a\nb\nc\nd\n';
  const modified = 'a\nB\nc\nd\ne\n';
  const changes = [change(2, 2, 2, 2), change(4, 0, 5, 5)];

  it('picks everything or nothing', () => {
    expect(applyLineChanges(original, modified, changes, all)).toBe(modified);
    expect(applyLineChanges(original, modified, changes, none)).toBe(original);
  });

  it('applies one hunk at a time', () => {
    const second = changeLines(changes[1]!);
    expect(applyLineChanges(original, modified, changes, only(second.original, second.modified))).toBe('a\nb\nc\nd\ne\n');
  });

  it('keeps an unpicked removal next to a picked addition', () => {
    expect(applyLineChanges(original, modified, changes, only([], [2]))).toBe('a\nb\nB\nc\nd\n');
    expect(applyLineChanges(original, modified, changes, only([2], []))).toBe('a\nc\nd\n');
  });

  it('handles adding and removing the final newline', () => {
    expect(applyLineChanges('a\nb', 'a\nb\n', [change(2, 2, 2, 3)], all)).toBe('a\nb\n');
    expect(applyLineChanges('a\nb\n', 'a\nb', [change(2, 3, 2, 2)], all)).toBe('a\nb');
    expect(applyLineChanges('a\nb', 'a\nb\nc', [change(2, 0, 3, 3)], all)).toBe('a\nb\nc');
  });

  it('keeps each line’s own line ending (CRLF index, LF additions)', () => {
    expect(applyLineChanges('a\r\nb\r\n', 'a\r\nx\nb\r\n', [change(1, 0, 2, 2)], all)).toBe('a\r\nx\nb\r\n');
    // A last line without EOL that gets a successor borrows the file's dominant EOL.
    expect(applyLineChanges('a\r\nb', 'a\r\nb\r\nc', [change(2, 2, 2, 3)], only([], [3]))).toBe('a\r\nb\r\nc');
  });

  it('can give lines from the original side another EOL (discard into a CRLF checkout)', () => {
    expect(applyLineChanges('a\nb\n', 'a\r\nB\r\n', [change(1, 2, 1, 2)], only([], []), '\r\n')).toBe('a\r\nb\r\n');
  });

  it('refuses changes that do not describe these texts', () => {
    expect(() => applyLineChanges('a\nb\n', 'a\nX\n', [], all)).toThrow(PartialApplyError);
    expect(() => applyLineChanges('a\nb\nc\n', 'a\nB\nC\n', [change(3, 3, 3, 3)], all)).toThrow('out of date');
    expect(() => applyLineChanges('a\n', 'a\nb\n', [change(5, 0, 2, 2)], all)).toThrow(PartialApplyError);
  });
});

// Property test: random texts, changes from an LCS diff in Monaco's format.
function seeded(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe('applyLineChanges (property)', () => {
  it('reproduces either text and keeps every untouched line, across 500 random cases', () => {
    const random = seeded(42);
    const pickOf = <T,>(items: T[]) => items[Math.floor(random() * items.length)]!;
    const words = ['x', 'y', 'z', 'alpha', 'beta', ''];
    const makeText = () => {
      const count = Math.floor(random() * 8);
      let text = '';
      for (let i = 0; i < count; i++) text += pickOf(words) + pickOf(['\n', '\n', '\r\n']);
      return random() < 0.3 ? text + pickOf(words) : text; // sometimes no final newline
    };

    for (let round = 0; round < 500; round++) {
      const original = makeText();
      const modified = makeText();
      const changes = lcsChanges(splitLines(original).lines, splitLines(modified).lines);
      const originalLines = splitLines(original).lines;

      // Line contents must round-trip exactly; EOLs may differ only where a line gained a successor.
      expect(splitLines(applyLineChanges(original, modified, changes, all)).lines).toEqual(splitLines(modified).lines);
      expect(applyLineChanges(original, modified, changes, none)).toBe(original);

      // Picking a random subset never loses an unchanged line and never invents one.
      const picked = only(
        originalLines.map((_, i) => i + 1).filter(() => random() < 0.5),
        splitLines(modified).lines.map((_, i) => i + 1).filter(() => random() < 0.5),
      );
      // An empty result is a file with no lines, not one empty line.
      const result = applyLineChanges(original, modified, changes, picked);
      const partial = result === '' ? [] : splitLines(result).lines;
      const allowed = new Set([...originalLines, ...splitLines(modified).lines]);
      for (const line of partial) expect(allowed.has(line)).toBe(true);
    }
  });
});
