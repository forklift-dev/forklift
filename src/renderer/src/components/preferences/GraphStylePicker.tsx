import { EdgeKind, type GraphRowLayout } from '../../../../shared/graph';
import { t, translate } from '../../../../shared/i18n';
import { edgePath, GRAPH_STYLES, laneX, type GraphStyle } from '../../graphStyles';
import type { ControlProps } from './SettingRow';

// Four rows of a small history: a branch leaves main and comes back in a merge.
const SAMPLE: Array<{ layout: GraphRowLayout; merge?: boolean }> = [
  { layout: { column: 0, color: 0, width: 2, edges: [{ kind: EdgeKind.Out, from: 0, to: 0, color: 0 }, { kind: EdgeKind.Out, from: 0, to: 1, color: 1 }] }, merge: true },
  { layout: { column: 1, color: 1, width: 2, edges: [{ kind: EdgeKind.Pass, from: 0, to: 0, color: 0 }, { kind: EdgeKind.In, from: 1, to: 1, color: 1 }, { kind: EdgeKind.Out, from: 1, to: 1, color: 1 }] } },
  { layout: { column: 0, color: 0, width: 2, edges: [{ kind: EdgeKind.In, from: 0, to: 0, color: 0 }, { kind: EdgeKind.Out, from: 0, to: 0, color: 0 }, { kind: EdgeKind.Pass, from: 1, to: 1, color: 1 }] } },
  { layout: { column: 0, color: 0, width: 2, edges: [{ kind: EdgeKind.In, from: 0, to: 0, color: 0 }, { kind: EdgeKind.In, from: 1, to: 0, color: 1 }] } },
];

export function GraphStylePreview({ style }: { style: GraphStyle }) {
  const width = style.laneWidth * 3;
  return (
    <span className="graph-style-preview">
      {SAMPLE.map(({ layout, merge }, row) => {
        const x = laneX(style, layout.column);
        const mid = style.rowHeight / 2;
        const r = merge ? style.mergeRadius : style.nodeRadius;
        const lane = `lane-${layout.color}`;
        return (
          <svg key={row} className="graph-cell" width={width + 60} height={style.rowHeight} style={{ strokeWidth: style.lineWidth }} aria-hidden="true">
            {style.streak && <rect x={x} y={2} width={width + 60 - x} height={style.rowHeight - 4} className={`streak ${lane}`} />}
            {layout.edges.map((edge, index) => (
              <path key={index} d={edgePath(style, edge)} className={`edge lane-${edge.color}`} />
            ))}
            {merge || style.nodes === 'dot' ? (
              <circle cx={x} cy={mid} r={r} className={`node ${lane}${merge ? ' merge' : ''}`} />
            ) : style.nodes === 'station' ? (
              <circle cx={x} cy={mid} r={r} className={`node station ${lane}`} />
            ) : (
              <>
                <circle cx={x} cy={mid} r={r - 1} className={`avatar-fill lane-${(row * 3 + 2) % 10}`} />
                <circle cx={x} cy={mid} r={r - 1} className={`node-ring ${lane}`} />
              </>
            )}
            <rect x={width + 6} y={mid - 2} width={30 + ((row * 13) % 24)} height={4} rx={2} className="preview-text" />
          </svg>
        );
      })}
    </span>
  );
}

/** `ui.graphStyle` as cards with a small drawing of each style. */
export function GraphStylePicker({ id, value, save }: ControlProps) {
  return (
    <div id={id} className="theme-picker graph-style-picker" role="radiogroup" aria-label={t('Commit graph')}>
      {GRAPH_STYLES.map((style) => (
        <button key={style.id} type="button" role="radio" aria-checked={value === style.id} className={`theme-option${value === style.id ? ' selected' : ''}`} data-graph-style={style.id} onClick={() => void save(style.id)}>
          <GraphStylePreview style={style} />
          <span className="theme-option-label">{translate(style.name)}</span>
        </button>
      ))}
    </div>
  );
}
