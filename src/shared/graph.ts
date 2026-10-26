// Commit graph layout: assigns each commit a column ("lane") and lists the line segments drawn in its row.
// Incremental: rows are laid out top to bottom as history is walked, each depending only on the rows above.

/** How a segment crosses a row: from the top edge, through the commit node, to the bottom edge. */
export const EdgeKind = {
  /** A lane that passes this row: top of `from` → bottom of `to` (always the same column). */
  Pass: 0,
  /** A lane that ends in this commit: top of `from` → node. */
  In: 1,
  /** A line to a parent: node → bottom of `to`. */
  Out: 2,
} as const;
export type EdgeKind = (typeof EdgeKind)[keyof typeof EdgeKind];

/** One drawn segment; `color` is a lane color index (the renderer maps it onto its palette). */
export interface GraphEdge {
  kind: EdgeKind;
  from: number;
  to: number;
  color: number;
}

export interface GraphRowLayout {
  /** Column of the commit node. */
  column: number;
  color: number;
  edges: GraphEdge[];
  /** Columns in use in this row (node and lines), for sizing the graph area. */
  width: number;
}

interface Lane {
  /** The commit this lane is waiting for (a parent of a row above). */
  sha: string;
  color: number;
}

/**
 * Lanes keep their column for as long as they run, so lines stay straight; a freed column is reused
 * by the next lane that needs one. A commit continues in the leftmost lane that was waiting for it;
 * other lanes waiting for it end there (branches forked from it). Its first parent continues its lane,
 * unless a lane to the left already waits for that parent; further parents (merges) join an existing
 * lane or start a new one.
 */
/** A layout's state between two rows: continuing from it lays out the following rows exactly as before. */
export interface GraphLayoutState {
  readonly lanes: readonly (Lane | null)[];
  readonly nextColor: number;
}

export class GraphLayout {
  private lanes: (Lane | null)[] = [];
  private nextColor = 0;

  /** Continues from a saved state (lanes are never changed in place, so they are shared). */
  static from(state: GraphLayoutState): GraphLayout {
    const layout = new GraphLayout();
    layout.lanes = [...state.lanes];
    layout.nextColor = state.nextColor;
    return layout;
  }

  state(): GraphLayoutState {
    return { lanes: [...this.lanes], nextColor: this.nextColor };
  }

  next(sha: string, parents: readonly string[]): GraphRowLayout {
    this.index = null;
    const edges: GraphEdge[] = [];
    const hits: number[] = [];
    this.lanes.forEach((lane, index) => lane?.sha === sha && hits.push(index));

    let column: number;
    let color: number;
    if (hits.length) {
      column = hits[0]!;
      color = this.lanes[column]!.color;
    } else {
      // A branch tip: nothing above leads here.
      column = this.freeColumn();
      color = this.nextColor++;
    }

    let width = Math.max(this.lanes.length, column + 1);
    this.lanes.forEach((lane, index) => {
      if (!lane) return;
      if (lane.sha === sha) edges.push({ kind: EdgeKind.In, from: index, to: column, color: lane.color });
    });
    for (const index of hits) this.lanes[index] = null;
    // Lanes still waiting for something else pass through (collected after the hits are freed, so a
    // lane started below for a parent never counts as passing from the top).
    const passing = this.lanes.map((lane, index) => (lane ? index : -1)).filter((index) => index >= 0);

    parents.forEach((parent, order) => {
      const waiting = this.lanes.findIndex((lane) => lane?.sha === parent);
      // Another lane already leads to this parent: merges join it, and so does the first parent when that lane
      // is to the left. One to the right is not taken over (it is already drawn): both lanes meet at the parent,
      // which then sits in the leftmost of them, as `git log --graph` draws it.
      if (waiting >= 0 && (order > 0 || waiting < column)) {
        edges.push({ kind: EdgeKind.Out, from: column, to: waiting, color: order === 0 ? color : this.lanes[waiting]!.color });
        return;
      }
      const target = order === 0 && !this.lanes[column] ? column : this.freeColumn();
      const laneColor = order === 0 ? color : this.nextColor++;
      this.lanes[target] = { sha: parent, color: laneColor };
      edges.push({ kind: EdgeKind.Out, from: column, to: target, color: laneColor });
    });

    for (const index of passing) edges.push({ kind: EdgeKind.Pass, from: index, to: index, color: this.lanes[index]!.color });
    while (this.lanes.length && this.lanes.at(-1) === null) this.lanes.pop();
    width = Math.max(width, this.lanes.length);
    return { column, color, edges, width };
  }

  /**
   * Moves past a row exactly as `next` would, without building its edges: for reading far ahead (a history
   * of millions of commits can keep hundreds of lanes open, and `next` lists every one of them per row).
   * Lanes are looked up through an index (sha → lanes, free columns), built on first use.
   */
  advance(sha: string, parents: readonly string[]): void {
    const lanes = this.lanes;
    const index = (this.index ??= this.buildIndex());
    let column = -1;
    let color = 0;
    const hits = index.waiting.get(sha);
    if (hits) {
      column = hits[0]!;
      color = lanes[column]!.color;
      for (const hit of hits) {
        lanes[hit] = null;
        heapPush(index.free, hit);
      }
      index.waiting.delete(sha);
    } else {
      column = this.peekFree(index);
      color = this.nextColor++;
    }
    for (let order = 0; order < parents.length; order++) {
      const parent = parents[order]!;
      const waiting = index.waiting.get(parent)?.[0] ?? -1;
      if (waiting >= 0 && (order > 0 || waiting < column)) continue;
      const target = order === 0 && !lanes[column] ? column : this.peekFree(index);
      lanes[target] = { sha: parent, color: order === 0 ? color : this.nextColor++ };
      const list = index.waiting.get(parent);
      if (!list) index.waiting.set(parent, [target]);
      else list.splice(sortedIndex(list, target), 0, target);
    }
    while (lanes.length && lanes.at(-1) === null) lanes.pop();
  }

  /** advance's lookups; `next` changes lanes without them, so it drops the index. */
  private index: { waiting: Map<string, number[]>; free: number[] } | null = null;

  private buildIndex() {
    const waiting = new Map<string, number[]>();
    const free: number[] = [];
    this.lanes.forEach((lane, i) => {
      if (!lane) return heapPush(free, i);
      const list = waiting.get(lane.sha);
      if (list) list.push(i);
      else waiting.set(lane.sha, [i]);
    });
    return { waiting, free };
  }

  /** The leftmost free column (as freeColumn), skipping heap entries taken or trimmed since. */
  private peekFree(index: { free: number[] }): number {
    const heap = index.free;
    while (heap.length && (heap[0]! >= this.lanes.length || this.lanes[heap[0]!] !== null)) heapPop(heap);
    return heap.length ? heap[0]! : this.lanes.length;
  }

  private freeColumn(): number {
    const free = this.lanes.indexOf(null);
    return free < 0 ? this.lanes.length : free;
  }
}

function sortedIndex(list: number[], value: number): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid]! < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** A binary min-heap of column numbers in a plain array. */
function heapPush(heap: number[], value: number): void {
  heap.push(value);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent]! <= value) break;
    heap[i] = heap[parent]!;
    i = parent;
  }
  heap[i] = value;
}

function heapPop(heap: number[]): void {
  const last = heap.pop()!;
  if (!heap.length) return;
  let i = 0;
  for (;;) {
    const left = 2 * i + 1;
    if (left >= heap.length) break;
    const child = left + 1 < heap.length && heap[left + 1]! < heap[left]! ? left + 1 : left;
    if (heap[child]! >= last) break;
    heap[i] = heap[child]!;
    i = child;
  }
  heap[i] = last;
}
