import { describe, expect, it } from 'vitest';
import { CommitTable } from './commits';

const sha = (n: number, width = 20) => n.toString(16).padStart(width * 2, '0');

describe('CommitTable', () => {
  it('keeps shas and parents of every row and finds rows by sha, across growth', () => {
    const commits = new CommitTable(20, 4);
    const count = 10_000;
    for (let i = 0; i < count; i++) {
      const parents = i % 7 === 0 ? `${sha(i + 1)} ${sha(i + 2)}` : i === count - 1 ? '' : sha(i + 1);
      expect(commits.add(sha(i), parents)).toBe(i);
    }
    expect(commits.length).toBe(count);
    expect(commits.hash(0)).toBe(sha(0));
    expect(commits.parents(0)).toEqual([sha(1), sha(2)]);
    expect(commits.parents(1)).toEqual([sha(2)]);
    expect(commits.parents(count - 1)).toEqual([]);
    for (const i of [0, 1, 4095, 4096, count - 1]) expect(commits.find(sha(i))).toBe(i);
  });

  it('does not find what it does not hold, including malformed and abbreviated shas', () => {
    const commits = new CommitTable();
    commits.add(sha(1), '');
    expect(commits.find(sha(2))).toBe(-1);
    expect(commits.find(sha(1).slice(0, 12))).toBe(-1);
    expect(commits.find('z'.repeat(40))).toBe(-1);
    expect(commits.find(sha(1).toUpperCase())).toBe(0);
  });

  it('holds SHA-256 shas', () => {
    const commits = new CommitTable(32);
    commits.add(sha(5, 32), `${sha(6, 32)} ${sha(7, 32)}`);
    commits.add(sha(6, 32), '');
    expect(commits.hash(0)).toBe(sha(5, 32));
    expect(commits.parents(0)).toEqual([sha(6, 32), sha(7, 32)]);
    expect(commits.find(sha(6, 32))).toBe(1);
  });

  it('is restored from its parts and keeps growing', () => {
    const commits = new CommitTable();
    for (let i = 0; i < 100; i++) commits.add(sha(i), sha(i + 1));
    const restored = CommitTable.restore(commits.parts());
    expect(restored.find(sha(99))).toBe(99);
    expect(restored.parents(50)).toEqual([sha(51)]);
    for (let i = 100; i < 3000; i++) restored.add(sha(i), i % 2 ? '' : `${sha(i + 1)} ${sha(i + 2)}`);
    expect(restored.find(sha(2999))).toBe(2999);
    expect(restored.parents(2000)).toEqual([sha(2001), sha(2002)]);
    expect(restored.parents(99)).toEqual([sha(100)]);
  });
});

describe('CommitTable trimmed', () => {
  it('keeps its rows and grows again', () => {
    const commits = new CommitTable();
    for (let i = 0; i < 1500; i++) commits.add(sha(i), sha(i + 1));
    commits.trim();
    expect(commits.parts().shas.length).toBe(1500 * 20);
    expect(commits.parents(1499)).toEqual([sha(1500)]);
    commits.add(sha(1500), '');
    expect(commits.find(sha(1500))).toBe(1500);
    expect(commits.parents(1500)).toEqual([]);
  });
});

describe('CommitTable restored from empty parts', () => {
  it('grows from nothing', () => {
    const restored = CommitTable.restore(new CommitTable().parts());
    restored.add(sha(1), sha(2));
    restored.add(sha(2), '');
    expect(restored.parents(0)).toEqual([sha(2)]);
    const roots = new CommitTable();
    roots.add(sha(3), '');
    const again = CommitTable.restore(roots.parts());
    again.add(sha(4), sha(3));
    expect(again.parents(1)).toEqual([sha(3)]);
  });
});
