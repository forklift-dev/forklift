import { EdgeKind, type GraphEdge } from '../../shared/graph';

/** How the commit graph is drawn; every style is just these numbers and switches (colors come from the theme). */
export interface GraphStyle {
  id: string;
  name: string;
  rowHeight: number;
  laneWidth: number;
  /** Radius of an ordinary commit's node (an avatar's radius for `avatar` nodes). */
  nodeRadius: number;
  mergeRadius: number;
  lineWidth: number;
  /** bezier: smooth S-curves; rounded: straight runs with rounded corners (GitKraken); angled: 45° (metro map); square: right angles (rails). */
  curve: 'bezier' | 'rounded' | 'angled' | 'square';
  /** dot: a filled circle; avatar: the author's avatar in a ring of the lane color; station: a ring with a hollow middle. */
  nodes: 'dot' | 'avatar' | 'station';
  /** A faint band of the lane color from the node to the end of the graph column, and a bar before the message. */
  streak: boolean;
  /** Branch and tag labels filled with their lane's color, with a line to the node. */
  laneRefs: boolean;
}

export const GRAPH_STYLES: readonly GraphStyle[] = [
  { id: 'kraken', name: 'Kraken', rowHeight: 30, laneWidth: 22, nodeRadius: 11, mergeRadius: 5, lineWidth: 2.5, curve: 'rounded', nodes: 'avatar', streak: true, laneRefs: true },
  { id: 'classic', name: 'Classic', rowHeight: 28, laneWidth: 14, nodeRadius: 5, mergeRadius: 3.5, lineWidth: 2, curve: 'bezier', nodes: 'dot', streak: false, laneRefs: false },
  { id: 'compact', name: 'Compact', rowHeight: 22, laneWidth: 10, nodeRadius: 3.5, mergeRadius: 2.5, lineWidth: 1.5, curve: 'bezier', nodes: 'dot', streak: false, laneRefs: false },
  { id: 'metro', name: 'Metro', rowHeight: 30, laneWidth: 20, nodeRadius: 6, mergeRadius: 6, lineWidth: 4, curve: 'angled', nodes: 'station', streak: false, laneRefs: true },
  { id: 'thin', name: 'Thin', rowHeight: 26, laneWidth: 12, nodeRadius: 3, mergeRadius: 3, lineWidth: 1.25, curve: 'bezier', nodes: 'dot', streak: false, laneRefs: false },
  { id: 'rails', name: 'Rails', rowHeight: 28, laneWidth: 16, nodeRadius: 4.5, mergeRadius: 4.5, lineWidth: 3, curve: 'square', nodes: 'station', streak: false, laneRefs: false },
  { id: 'ribbon', name: 'Ribbon', rowHeight: 28, laneWidth: 16, nodeRadius: 5, mergeRadius: 3.5, lineWidth: 2, curve: 'rounded', nodes: 'dot', streak: true, laneRefs: true },
];

export const graphStyle = (id: string): GraphStyle => GRAPH_STYLES.find((style) => style.id === id) ?? GRAPH_STYLES[0]!;

export const laneX = (style: GraphStyle, lane: number) => style.laneWidth / 2 + lane * style.laneWidth;

/**
 * The SVG path of one edge in a row: `Pass` runs straight down; `In` comes from the top of its lane to the
 * node; `Out` leaves the node for the bottom of the parent's lane.
 */
export function edgePath(style: GraphStyle, edge: GraphEdge): string {
  const h = style.rowHeight;
  const mid = h / 2;
  const from = laneX(style, edge.from);
  const to = laneX(style, edge.to);
  if (edge.kind === EdgeKind.Pass) return `M${from} 0V${h}`;
  if (from === to) return edge.kind === EdgeKind.In ? `M${from} 0V${mid}` : `M${from} ${mid}V${h}`;
  const dx = to - from;
  const sign = Math.sign(dx);
  if (style.curve === 'bezier') {
    return edge.kind === EdgeKind.In
      ? `M${from} 0C${from} ${mid * 0.6} ${to} ${mid * 0.4} ${to} ${mid}`
      : `M${from} ${mid}C${from} ${mid * 1.6} ${to} ${mid * 1.4} ${to} ${h}`;
  }
  if (style.curve === 'square') {
    // Along the node's row, turning at a right angle into the other lane.
    return edge.kind === EdgeKind.In ? `M${from} 0V${mid}H${to}` : `M${from} ${mid}H${to}V${h}`;
  }
  if (style.curve === 'rounded') {
    // Along the node's row, then a rounded corner into the other lane (as GitKraken draws branches and merges).
    const r = Math.min(mid, Math.abs(dx) / 2, 8);
    return edge.kind === EdgeKind.In
      ? // From the top of the lane down to the node's row, turning toward the node.
        `M${from} 0V${mid - r}Q${from} ${mid} ${from + sign * r} ${mid}H${to}`
      : // From the node along its row, turning down into the parent's lane.
        `M${from} ${mid}H${to - sign * r}Q${to} ${mid} ${to} ${mid + r}V${h}`;
  }
  // angled: a 45° run, as far as the row allows.
  const run = Math.min(Math.abs(dx), mid);
  return edge.kind === EdgeKind.In
    ? `M${from} 0V${mid - run}L${from + sign * run} ${mid}H${to}`
    : `M${from} ${mid}H${to - sign * run}L${to} ${mid + run}V${h}`;
}
