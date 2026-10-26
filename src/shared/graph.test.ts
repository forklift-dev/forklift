import { describe, expect, it } from 'vitest';
import { EdgeKind, GraphLayout, type GraphRowLayout } from './graph';

/** Lays out [sha, ...parents] rows given top to bottom. */
function layout(rows: string[][]): GraphRowLayout[] {
  const graph = new GraphLayout();
  return rows.map(([sha, ...parents]) => graph.next(sha!, parents));
}

const edges = (row: GraphRowLayout, kind: EdgeKind) =>
  row.edges
    .filter((e) => e.kind === kind)
    .map((e) => `${e.from}>${e.to}`)
    .sort();

/** Draws the layout as text, one line per row: node column marked with *, passing lanes with |. */
function picture(rows: GraphRowLayout[]): string[] {
  return rows.map((row) => {
    const cells = Array.from({ length: row.width }, () => ' ');
    for (const e of row.edges) if (e.kind === EdgeKind.Pass) cells[e.from] = '|';
    cells[row.column] = '*';
    return cells.join('').trimEnd();
  });
}

describe('GraphLayout', () => {
  it('keeps a linear history in one column', () => {
    const rows = layout([['c', 'b'], ['b', 'a'], ['a']]);
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0]);
    expect(rows.map((r) => r.color)).toEqual([0, 0, 0]);
    expect(edges(rows[0]!, EdgeKind.Out)).toEqual(['0>0']);
    expect(edges(rows[1]!, EdgeKind.In)).toEqual(['0>0']);
    expect(rows[2]!.edges.filter((e) => e.kind === EdgeKind.Out)).toEqual([]);
  });

  it('draws a merged feature branch beside main and closes it at the fork point', () => {
    //   m   merge of f2 into m1
    //   |\
    //   | f2
    //   m1|
    //   | f1
    //   |/
    //   base
    const rows = layout([
      ['m', 'm1', 'f2'],
      ['f2', 'f1'],
      ['m1', 'base'],
      ['f1', 'base'],
      ['base'],
    ]);
    expect(picture(rows)).toEqual(['*', '|*', '*|', '|*', '*']);
    expect(edges(rows[0]!, EdgeKind.Out)).toEqual(['0>0', '0>1']);
    // f1's lane ends in base together with main's.
    expect(edges(rows[3]!, EdgeKind.Out)).toEqual(['1>0']);
    expect(edges(rows[4]!, EdgeKind.In)).toEqual(['0>0']);
    // The merged branch gets its own color, main keeps its own.
    expect(rows[1]!.color).not.toBe(rows[0]!.color);
    expect(rows[2]!.color).toBe(rows[0]!.color);
  });

  it('starts unmerged branch tips in free columns and lets them end where they forked', () => {
    // Two branches not merged anywhere, both forked from base; tips come first.
    const rows = layout([
      ['x2', 'x1'],
      ['main', 'base'],
      ['x1', 'base'],
      ['base'],
    ]);
    expect(rows.map((r) => r.column)).toEqual([0, 1, 0, 0]);
    expect(picture(rows)).toEqual(['*', '|*', '*|', '*']);
    expect(edges(rows[3]!, EdgeKind.In)).toEqual(['0>0', '1>0']);
  });

  it('reuses freed columns instead of growing without bound', () => {
    const rows: string[][] = [];
    // Ten short-lived branches merged one after another into a linear main.
    for (let i = 10; i > 0; i--) rows.push([`m${i}`, `m${i - 1}`, `f${i}`], [`f${i}`, `m${i - 1}`]);
    rows.push(['m0']);
    const result = layout(rows);
    expect(Math.max(...result.map((r) => r.width))).toBe(2);
    expect(result.every((r, i) => (i % 2 === 0 || i === result.length - 1 ? r.column === 0 : r.column === 1))).toBe(true);
  });

  it('joins a parent another lane already waits for instead of opening a second lane', () => {
    // a and b both have parent p; b's tip appears while a's lane already waits for p.
    const rows = layout([['a', 'p'], ['b', 'p'], ['p']]);
    expect(edges(rows[1]!, EdgeKind.Out)).toEqual(['1>0']);
    expect(rows[1]!.edges.find((e) => e.kind === EdgeKind.Pass)).toMatchObject({ from: 0, to: 0 });
    expect(rows[2]!.width).toBe(1);
  });

  it('handles octopus merges and root commits', () => {
    const rows = layout([['o', 'a', 'b', 'c'], ['a'], ['b'], ['c']]);
    expect(edges(rows[0]!, EdgeKind.Out)).toEqual(['0>0', '0>1', '0>2']);
    expect(new Set(rows[0]!.edges.map((e) => e.color)).size).toBe(3);
    expect(rows.map((r) => r.column)).toEqual([0, 0, 1, 2]);
    // Roots end their lanes; nothing passes below the last root.
    expect(rows[3]!.edges).toEqual([{ kind: EdgeKind.In, from: 2, to: 2, color: rows[0]!.edges.find((e) => e.to === 2)!.color }]);
  });

  it('every lane drawn from the top of a row was open at the bottom of the row above', () => {
    // Random histories: the bottom of each row must match the top of the next one.
    for (let seed = 1; seed <= 20; seed++) {
      let state = seed;
      const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
      const shas = Array.from({ length: 60 }, (_, i) => `c${i}`);
      // Parents always come later in the list (a valid topological order).
      const rows = shas.map((sha, i) => {
        const parents: string[] = [];
        if (i < shas.length - 1) parents.push(shas[i + 1 + Math.floor(random() * Math.min(5, shas.length - i - 1))]!);
        if (random() < 0.2 && i < shas.length - 2) parents.push(shas[i + 1 + Math.floor(random() * (shas.length - i - 1))]!);
        return [sha, ...new Set(parents)];
      });
      const result = layout(rows);
      for (let i = 1; i < result.length; i++) {
        const bottom = new Set(result[i - 1]!.edges.filter((e) => e.kind !== EdgeKind.In).map((e) => e.to));
        const top = new Set(result[i]!.edges.filter((e) => e.kind !== EdgeKind.Out).map((e) => e.from));
        expect([...top].sort()).toEqual([...bottom].sort());
      }
    }
  });
});

describe('GraphLayout.advance', () => {
  it('leaves the lanes exactly as next does, so layout can continue from either', () => {
    // A branchy random history: tips, forks, merges, octopus merges, roots.
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const rows: string[][] = [];
    const open: string[] = ['c0'];
    for (let i = 0; i < 3000 && open.length; i++) {
      const sha = open.splice(Math.floor(random() * Math.min(open.length, 3)), 1)[0]!;
      const parents: string[] = [];
      const count = i > 2950 ? 0 : random() < 0.15 ? 2 + Math.floor(random() * 2) : 1;
      for (let p = 0; p < count; p++) {
        const parent = random() < 0.3 && open.length ? open[Math.floor(random() * open.length)]! : `c${i}-${p}`;
        if (!parents.includes(parent)) parents.push(parent);
        if (!open.includes(parent)) open.push(parent);
      }
      if (random() < 0.05) open.push(`tip${i}`);
      rows.push([sha, ...parents]);
    }
    const drawn = new GraphLayout();
    const read = new GraphLayout();
    rows.forEach(([sha, ...parents], i) => {
      drawn.next(sha!, parents);
      read.advance(sha!, parents);
      if (i % 50 === 0) expect(read.state()).toEqual(drawn.state());
    });
    expect(read.state()).toEqual(drawn.state());
    // Continuing from the state read ahead draws the same rows.
    const tail = rows.slice(-100);
    const fromDrawn = GraphLayout.from(drawn.state());
    const fromRead = GraphLayout.from(read.state());
    for (const [sha, ...parents] of tail) expect(fromRead.next(sha!, parents)).toEqual(fromDrawn.next(sha!, parents));
  });
});
