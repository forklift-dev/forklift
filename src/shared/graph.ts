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
export class GraphLayout {
  private lanes: (Lane | null)[] = [];
  private nextColor = 0;

  next(sha: string, parents: readonly string[]): GraphRowLayout {
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

  private freeColumn(): number {
    const free = this.lanes.indexOf(null);
    return free < 0 ? this.lanes.length : free;
  }
}
