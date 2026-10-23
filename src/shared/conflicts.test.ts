import { describe, expect, it } from 'vitest';
import { chosenLines, parseConflicts, resolveBlock } from './conflicts';

const merge = ['top', '<<<<<<< HEAD', 'ours 1', 'ours 2', '=======', 'theirs', '>>>>>>> feature', 'middle', '<<<<<<< HEAD', '=======', 'only theirs', '>>>>>>> feature', 'end', ''].join('\n');

describe('parseConflicts', () => {
  it('finds blocks with sides, labels and line numbers', () => {
    const blocks = parseConflicts(merge);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ startLine: 2, separatorLine: 5, endLine: 7, ours: ['ours 1', 'ours 2'], theirs: ['theirs'], base: null, oursLabel: 'HEAD', theirsLabel: 'feature' });
    expect(blocks[1]).toMatchObject({ startLine: 9, endLine: 12, ours: [], theirs: ['only theirs'] });
  });

  it('reads the base of diff3/zdiff3 and CRLF files', () => {
    const text = ['<<<<<<< ours', 'a', '||||||| merged common ancestors', 'o', '=======', 'b', '>>>>>>> theirs'].join('\r\n');
    const [block] = parseConflicts(text);
    expect(block).toMatchObject({ ours: ['a\r'], base: ['o\r'], theirs: ['b\r'], oursLabel: 'ours', theirsLabel: 'theirs', baseLine: 3 });
  });

  it('ignores unfinished blocks and marker-like text', () => {
    expect(parseConflicts('<<<<<<< HEAD\nx\n=======\ny\n')).toEqual([]);
    expect(parseConflicts('<<<<<<<< not a marker\n=======\n>>>>>>> x\n')).toEqual([]);
    expect(parseConflicts('<<<<<<< a\nx\n<<<<<<< b\ny\n=======\nz\n>>>>>>> b\n')).toHaveLength(1);
  });
});

describe('resolveBlock', () => {
  it.each([
    ['ours', 'top\nours 1\nours 2\nmiddle'],
    ['theirs', 'top\ntheirs\nmiddle'],
    ['both', 'top\nours 1\nours 2\ntheirs\nmiddle'],
    ['theirs-ours', 'top\ntheirs\nours 1\nours 2\nmiddle'],
    ['base', 'top\nmiddle'],
  ] as const)('%s', (choice, start) => {
    const result = resolveBlock(merge, parseConflicts(merge)[0]!, choice);
    expect(result.startsWith(start)).toBe(true);
    expect(parseConflicts(result)).toHaveLength(1);
  });

  it('chosen lines for an empty side', () => {
    expect(chosenLines(parseConflicts(merge)[1]!, 'ours')).toEqual([]);
  });
});
