import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { colorIndex, initials } from '../../../shared/avatars';
import { EdgeKind, type GraphRowLayout } from '../../../shared/graph';
import type { HistoryFilter, HistoryRow } from '../../../shared/history';
import type { BisectStatus } from '../../../shared/bisect';
import type { RepoData } from '../../../shared/state';
import { formatDate, t } from '../../../shared/i18n';
import { historyPages } from '../history';
import { Avatar, useAvatarPicture } from './Avatar';
import { edgePath, graphStyle, laneX, type GraphStyle } from '../graphStyles';
import { useAppState } from '../state';
import { DEFAULT_LAYOUT, LIMITS, resetColumns, setColumnWidth, toggleColumn, useLayout, type ColumnId } from '../layout';
import { Splitter } from './Splitter';
import { useContextMenu } from './ContextMenu';

const MAX_GRAPH_LANES = 16;
const OVERSCAN = 20;

/** The author in a node: Gravatar picture when there is one, else initials on the author's color. */
function AvatarNode({ x, y, r, name, email, ring }: { x: number; y: number; r: number; name: string; email: string; ring: string }) {
  const picture = useAvatarPicture(email);
  const id = useId();
  return (
    <g className="avatar-node">
      {picture ? (
        <>
          <clipPath id={id}>
            <circle cx={x} cy={y} r={r - 1} />
          </clipPath>
          <image href={picture} x={x - r + 1} y={y - r + 1} width={(r - 1) * 2} height={(r - 1) * 2} clipPath={`url(#${id})`} />
        </>
      ) : (
        <>
          <circle cx={x} cy={y} r={r - 1} className={`avatar-fill lane-${colorIndex(email || name)}`} />
          <text x={x} y={y} className="avatar-initials" fontSize={Math.round(r * 0.8)}>
            {initials(name, email)}
          </text>
        </>
      )}
      <circle cx={x} cy={y} r={r - 1} className={`node-ring ${ring}`} />
    </g>
  );
}

interface GraphCellProps {
  style: GraphStyle;
  layout: GraphRowLayout;
  width: number;
  merge: boolean;
  stash: boolean;
  wipAbove: boolean;
  author: { name: string; email: string };
  /** The row has branch or tag labels: draw the line from them to the node. */
  refs: boolean;
}

/** One row of the graph: lines through the row and the commit's node, drawn in `style`. */
function GraphCell({ style, layout, width, merge, stash, wipAbove, author, refs }: GraphCellProps) {
  const h = style.rowHeight;
  const mid = h / 2;
  const x = laneX(style, layout.column);
  const lane = `lane-${layout.color % 10}`;
  const r = merge ? style.mergeRadius : style.nodeRadius;
  return (
    <svg className="graph-cell" width={width} height={h} aria-hidden="true" style={{ strokeWidth: style.lineWidth }}>
      {style.streak && <rect x={x} y={2} width={Math.max(0, width - x)} height={h - 4} className={`streak ${lane}`} />}
      {style.laneRefs && refs && <line x1={0} y1={mid} x2={x - r} y2={mid} className={`ref-connector ${lane}`} />}
      {layout.edges.map((edge, index) => (
        <path key={index} d={edgePath(style, edge)} className={`edge lane-${edge.color % 10}${stash && edge.kind === EdgeKind.Out ? ' stash-edge' : ''}`} />
      ))}
      {wipAbove && <path d={`M${x} 0V${mid}`} className={`edge wip-edge ${lane}`} />}
      {stash ? (
        <rect x={x - style.mergeRadius - 1} y={mid - style.mergeRadius - 1} width={style.mergeRadius * 2 + 2} height={style.mergeRadius * 2 + 2} rx={2} className={`node stash-node ${lane}`} />
      ) : merge || style.nodes === 'dot' ? (
        <circle cx={x} cy={mid} r={r} className={`node ${lane}${merge ? ' merge' : ''}`} />
      ) : style.nodes === 'station' ? (
        <circle cx={x} cy={mid} r={r} className={`node station ${lane}`} />
      ) : (
        <AvatarNode x={x} y={mid} r={r} name={author.name} email={author.email} ring={lane} />
      )}
    </svg>
  );
}

interface PassingLanesProps {
  style: GraphStyle;
  pages: ReturnType<typeof historyPages>;
  /** History rows drawn (the list's rows minus the WIP row). */
  first: number;
  last: number;
  /** Where row `first` is, in the list's pixels. */
  top: number;
  left: number;
  width: number;
  /** The graph column scrolled sideways by this much. */
  scroll: number;
  dimmed: boolean;
}

/**
 * Lanes passing the rows in view, over all of them at once: one line per lane and page, a path per color,
 * instead of a line per lane in every row (linux keeps hundreds of lanes open for thousands of rows).
 * Only the columns in view are drawn.
 */
function PassingLanes({ style, pages, first, last, top, left, width, scroll, dimmed }: PassingLanesProps) {
  if (last < first) return null;
  const h = style.rowHeight;
  const from = Math.floor(scroll / style.laneWidth) - 1;
  const to = Math.ceil((scroll + width) / style.laneWidth);
  const paths = new Map<number, string>();
  for (const run of pages.passes(first, last)) {
    if (run.column < from || run.column > to) continue;
    const color = run.color % 10;
    const x = laneX(style, run.column);
    paths.set(color, `${paths.get(color) ?? ''}M${x} ${(run.first - first) * h}V${(run.first - first + run.count) * h}`);
  }
  return (
    <svg
      className={`graph-passes${dimmed ? ' dimmed' : ''}`}
      width={width}
      height={(last - first + 1) * h}
      aria-hidden="true"
      style={{ left, transform: `translateY(${top}px)`, strokeWidth: style.lineWidth }}
    >
      <g transform={`translate(${-scroll} 0)`}>
        {[...paths].map(([color, d]) => (
          <path key={color} d={d} className={`edge lane-${color}`} />
        ))}
      </g>
    </svg>
  );
}

function RefBadges({ labels }: { labels: string[] | undefined }) {
  if (!labels?.length) return null;
  return (
    <>
      {labels.map((label) => {
        const tag = label.startsWith('tag: ');
        const head = label.startsWith('HEAD');
        return (
          <span key={label} className={`ref${tag ? ' tag' : ''}${head ? ' head' : ''}`} title={label}>
            {tag ? label.slice(5) : label.replace(/^HEAD -> /, '')}
            {tag && <span className="codicon codicon-tag ref-icon" aria-hidden="true" />}
          </span>
        );
      })}
    </>
  );
}

interface CommitGraphProps {
  repo: string;
  data: RepoData;
  bisect?: BisectStatus | null;
  /** null: the working tree (WIP row) is selected. */
  selectedHash: string | null;
  onSelect(hash: string | null): void;
  onContextMenu?(event: MouseEvent, row: HistoryRow): void;
  filter: HistoryFilter;
  /** Rows matching the search, highlighted. */
  matches?: ReadonlySet<number>;
  /** Scroll to this row and select it once it is loaded (`nonce` repeats the same row). */
  reveal?: { index: number; nonce: number } | null;
}

/** Tallest scroll range used; Chromium caps element heights at about 33.5 million pixels (≈ 1.1 million rows). */
const MAX_SCROLL_HEIGHT = 30_000_000;

/**
 * The history list with its graph, virtualized: only rows in view are rendered and history pages are
 * fetched from main as they come into view. A "WIP" row on top stands for uncommitted changes.
 */
export function CommitGraph({ repo, data, bisect, selectedHash, onSelect, onContextMenu, filter, matches, reveal }: CommitGraphProps) {
  const bisectCandidates = useMemo(() => new Set(bisect?.candidates ?? []), [bisect]);
  const baseStyle = graphStyle(useAppState((s) => s.settings.values['ui.graphStyle']));
  // Reserve a second label line throughout the graph when refs share a commit. Keeping one row height
  // for the virtual list preserves correct positions for unloaded history pages and leaves a clear gap
  // before the next commit's labels.
  const hasStackedRefs = Object.values(data.refs).some((labels) => labels.length > 1);
  const style = hasStackedRefs ? { ...baseStyle, rowHeight: baseStyle.rowHeight + 12 } : baseStyle;
  const ROW_HEIGHT = style.rowHeight;
  const pages = historyPages(repo, data.historyVersion, filter);
  useSyncExternalStore(pages.subscribe, pages.getSnapshot);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  useLayoutEffect(() => {
    const element = scrollRef.current!;
    const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, []);

  const wip = data.changes.length > 0;
  const offset = wip ? 1 : 0;
  const total = offset + pages.rowCount;
  // Rows are placed in "virtual" pixels (index × row height); past what an element may be tall, the scroll
  // range is squeezed and scroll positions map onto virtual ones proportionally.
  const virtualHeight = total * ROW_HEIGHT;
  const domHeight = Math.min(virtualHeight, MAX_SCROLL_HEIGHT);
  const scale = domHeight > viewport.height && virtualHeight > domHeight ? (virtualHeight - viewport.height) / (domHeight - viewport.height) : 1;
  // Effects below read the current scale without depending on it (they scroll once per cause).
  const scaleRef = useRef(scale);
  useLayoutEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  const toDom = (top: number) => top / scaleRef.current;
  const virtualTop = viewport.top * scale;
  const first = Math.max(0, Math.floor(virtualTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(total - 1, Math.ceil((virtualTop + viewport.height) / ROW_HEIGHT) + OVERSCAN);

  useEffect(() => {
    pages.request(first - offset, Math.max(0, last - offset));
  }, [pages, first, last, offset]);

  const lanes = Math.min(MAX_GRAPH_LANES, Math.max(pages.maxWidth, 1));
  // The lanes need `lanesWidth`; the column is that wide unless the user set its width (then it scrolls).
  const lanesWidth = lanes * style.laneWidth + 4;
  const layout = useLayout();
  const graphWidth = layout.columns.graph ?? lanesWidth;
  const maxGraphScroll = Math.max(0, lanesWidth - graphWidth);
  const [graphScrollState, setGraphScroll] = useState(0);
  const graphScroll = Math.min(graphScrollState, maxGraphScroll);
  const svgWidth = Math.max(lanesWidth, graphWidth);
  const { open: openMenu, menu } = useContextMenu();
  const headerMenu = (event: MouseEvent) =>
    openMenu(event, [
      { label: layout.hidden.author ? t('Show the Author column') : t('Hide the Author column'), onSelect: () => toggleColumn('author') },
      { label: layout.hidden.date ? t('Show the Date column') : t('Hide the Date column'), onSelect: () => toggleColumn('date') },
      { label: layout.hidden.sha ? t('Show the SHA column') : t('Hide the SHA column'), onSelect: () => toggleColumn('sha') },
      'separator',
      { label: t('Fit the graph column to its lanes'), disabled: layout.columns.graph === null, onSelect: () => setColumnWidth('graph', null) },
      { label: t('Reset columns'), onSelect: resetColumns },
    ]);
  const resizer = (column: ColumnId, label: string, edge: 'start' | 'end', width: number) => (
    <Splitter
      kind="col-resizer"
      className={edge}
      label={t('Resize the {label} column', { label })}
      value={width}
      min={LIMITS[column][0]}
      max={LIMITS[column][1]}
      direction={edge === 'end' ? 1 : -1}
      onChange={(value) => setColumnWidth(column, value)}
      onReset={() => setColumnWidth(column, column === 'graph' ? null : DEFAULT_LAYOUT.columns[column])}
    />
  );
  const scrollGraph = (delta: number) => setGraphScroll((current) => Math.max(0, Math.min(maxGraphScroll, Math.min(current, maxGraphScroll) + delta)));
  const headIsFirst = pages.row(0)?.hash === data.branch.oid;
  const staged = data.changes.filter((change) => change.staged).length;
  const unstaged = data.changes.filter((change) => change.unstaged).length;

  const select = (index: number) => {
    if (index < offset) return onSelect(null);
    const row = pages.row(index - offset);
    if (row) onSelect(row.hash);
  };

  const selectedIndex = selectedHash ? pages.indexOf(selectedHash) + offset : wip ? 0 : -1;

  // A row revealed by index (search results, a branch located in main): scroll there, select once loaded.
  const pendingReveal = useRef<{ index: number; nonce: number } | null>(null);
  useEffect(() => {
    if (!reveal) return;
    pendingReveal.current = reveal;
    const element = scrollRef.current;
    if (element) element.scrollTop = Math.max(0, (reveal.index + offset) * ROW_HEIGHT - element.clientHeight / 3) / scaleRef.current;
  }, [reveal, offset, ROW_HEIGHT]);
  useEffect(() => {
    const target = pendingReveal.current;
    if (!target) return;
    const row = pages.row(target.index);
    const element = scrollRef.current;
    if (!row) {
      // Not loaded yet (and the list may not be that long yet): fetch its page; scroll again once it grows.
      pages.request(target.index, target.index);
      if (element && (target.index + offset) * ROW_HEIGHT < virtualHeight) {
        element.scrollTop = toDom(Math.max(0, (target.index + offset) * ROW_HEIGHT - element.clientHeight / 3));
      }
      return;
    }
    pendingReveal.current = null;
    if (element) element.scrollTop = toDom(Math.max(0, (target.index + offset) * ROW_HEIGHT - element.clientHeight / 3));
    if (row.hash !== selectedHash) onSelect(row.hash);
  });

  // A commit selected from elsewhere (a branch in the left panel) is scrolled into view once.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedHash || revealed.current === selectedHash || selectedIndex < offset) return;
    revealed.current = selectedHash;
    const element = scrollRef.current;
    if (!element) return;
    const top = selectedIndex * ROW_HEIGHT;
    const shown = element.scrollTop * scaleRef.current;
    if (top < shown || top + 2 * ROW_HEIGHT > shown + element.clientHeight) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 3) / scaleRef.current;
    }
  }, [selectedHash, selectedIndex, offset, ROW_HEIGHT]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = Math.max(0, Math.min(total - 1, (selectedIndex < 0 ? -1 : selectedIndex) + (event.key === 'ArrowDown' ? 1 : -1)));
    select(next);
    // Rows start below the sticky header (one row high), so row `next` spans content y (next+1)…(next+2) rows.
    const element = scrollRef.current!;
    const top = next * ROW_HEIGHT;
    const shown = element.scrollTop * scale;
    if (top < shown) element.scrollTop = toDom(top);
    else if (top + 2 * ROW_HEIGHT > shown + element.clientHeight) element.scrollTop = toDom(top + 2 * ROW_HEIGHT - element.clientHeight);
  };

  const rows = [];
  for (let index = first; index <= last; index++) {
    const position = { transform: `translateY(${index * ROW_HEIGHT - virtualTop + viewport.top}px)` };
    if (index < offset) {
      const column = headIsFirst ? (pages.row(0)?.graph.column ?? 0) : 0;
      rows.push(
        <div key="wip" role="row" aria-selected={selectedHash === null} className={`commit-row wip${selectedHash === null ? ' selected' : ''}`} style={position} onClick={() => onSelect(null)}>
          <div className="cell refs" />
          <div className="cell graph" style={{ width: graphWidth }}>
            <svg className="graph-cell" width={svgWidth} height={ROW_HEIGHT} aria-hidden="true" style={{ strokeWidth: style.lineWidth }}>
              {headIsFirst && <path d={`M${laneX(style, column)} ${ROW_HEIGHT / 2}V${ROW_HEIGHT}`} className="edge wip-edge" />}
              <circle cx={laneX(style, column)} cy={ROW_HEIGHT / 2} r={Math.max(style.nodeRadius - 1, 4)} className="node wip-node" />
            </svg>
          </div>
          <div className="cell message">
            <span className="wip-label">{'// WIP'}</span>
            <span className="wip-counts">
              {staged > 0 && t('{count} staged', { count: staged })}
              {staged > 0 && unstaged > 0 && ', '}
              {unstaged > 0 && t('{count} unstaged', { count: unstaged })}
            </span>
          </div>
          <div className="cell author" />
          <div className="cell date" />
          <div className="cell sha" />
        </div>,
      );
      continue;
    }
    const row: HistoryRow | undefined = pages.row(index - offset);
    if (!row) {
      rows.push(<div key={`placeholder-${index}`} className="commit-row placeholder" style={position} aria-hidden="true" />);
      continue;
    }
    const selected = row.hash === selectedHash;
    rows.push(
      <div
        key={row.hash}
        role="row"
        aria-selected={selected}
        className={`commit-row lane-${row.graph.color % 10}${selected ? ' selected' : ''}${row.stash ? ' stash' : ''}${matches?.has(index - offset) ? ' match' : ''}${matches && matches.size && !matches.has(index - offset) ? ' dimmed' : ''}${bisect?.remaining !== null && bisect?.remaining !== undefined && !bisectCandidates.has(row.hash) && row.hash !== bisect.bad && !bisect.good.includes(row.hash) && !bisect.skipped.includes(row.hash) ? ' bisect-excluded' : ''}`}
        style={position}
        data-hash={row.hash}
        onClick={() => onSelect(row.hash)}
        onContextMenu={onContextMenu && ((event) => onContextMenu(event, row))}
      >
        <div className={`cell refs${row.stash || data.refs[row.hash]?.length ? ' has-refs' : ''}`}>
          {row.stash ? <span className="ref stash-ref">stash@{`{${row.stash.index}}`}</span> : <RefBadges labels={data.refs[row.hash]} />}
        </div>
        <div className="cell graph" style={{ width: graphWidth }}>
          <GraphCell
            style={style}
            layout={row.graph}
            width={svgWidth}
            merge={row.parents.length > 1}
            stash={Boolean(row.stash)}
            wipAbove={wip && index === offset && row.hash === data.branch.oid}
            author={{ name: row.authorName, email: row.authorEmail }}
            refs={Boolean(row.stash || data.refs[row.hash]?.length)}
          />
        </div>
        <div className="cell message subject" title={row.subject}>
          {bisect?.found === row.hash && <span className="bisect-badge bad">{t('First bad')}</span>}
          {bisect?.bad === row.hash && bisect.found !== row.hash && <span className="bisect-badge bad">{t('Bad')}</span>}
          {bisect?.good.includes(row.hash) && <span className="bisect-badge good">{t('Good')}</span>}
          {bisect?.skipped.includes(row.hash) && <span className="bisect-badge skip">{t('Skipped')}</span>}
          {row.subject}
        </div>
        <div className="cell author" title={row.authorEmail}>
          <Avatar name={row.authorName} email={row.authorEmail} />
          <span className="author-name">{row.authorName}</span>
        </div>
        <div className="cell date">{formatDate(row.authorTime * 1000, { dateStyle: 'medium', timeStyle: 'short' })}</div>
        <div className="cell sha">{row.hash.slice(0, 7)}</div>
      </div>,
    );
  }

  const empty = pages.complete && pages.loaded === 0 && !wip;
  return (
    <section
      className={`commits graph-style-${style.id}${style.laneRefs ? ' lane-refs' : ''}${style.streak ? ' streak-rows' : ''}${layout.hidden.author ? ' hide-author' : ''}${layout.hidden.date ? ' hide-date' : ''}${layout.hidden.sha ? ' hide-sha' : ''}`}
      aria-label={t('Commit history')}
      style={
        {
          '--row-height': `${ROW_HEIGHT}px`,
          '--col-refs': `${layout.columns.refs}px`,
          '--col-author': `${layout.columns.author}px`,
          '--col-date': `${layout.columns.date}px`,
          '--col-sha': `${layout.columns.sha}px`,
          '--graph-scroll': graphScroll,
        } as CSSProperties
      }
    >
      {pages.error && <div className="diff-message error">{pages.error}</div>}
      {empty && <div className="empty-note">{t('No commits yet')}</div>}
      <div
        className="commit-scroll"
        ref={scrollRef}
        role="grid"
        aria-rowcount={total}
        tabIndex={0}
        onKeyDown={onKeyDown}
        hidden={empty}
        onWheel={(event) => {
          // Sideways over the graph column: shift+wheel, or a horizontal wheel/touchpad.
          if (!maxGraphScroll || !(event.target as Element).closest('.cell.graph')) return;
          const delta = event.shiftKey ? event.deltaY || event.deltaX : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
          if (delta) scrollGraph(delta);
        }}
      >
        {/* Inside the scroll area (sticky), so its columns line up with the rows beside the scrollbar. */}
        <div className="commit-header" role="row" onContextMenu={headerMenu}>
          <div className="cell refs">
            <span className="header-label">{t('Branch / Tag')}</span>
            {resizer('refs', t('Branch / Tag'), 'end', layout.columns.refs)}
          </div>
          <div className="cell graph" style={{ width: graphWidth }}>
            <span className="header-label">{t('Graph')}</span>
            {resizer('graph', t('Graph'), 'end', graphWidth)}
          </div>
          <div className="cell message">
            <span className="header-label">{t('Commit message')}</span>
          </div>
          <div className="cell author">
            {resizer('author', t('Author'), 'start', layout.columns.author)}
            <span className="header-label">{t('Author')}</span>
          </div>
          <div className="cell date">
            {resizer('date', t('Date'), 'start', layout.columns.date)}
            <span className="header-label">{t('Date')}</span>
          </div>
          <div className="cell sha">
            {resizer('sha', t('SHA'), 'start', layout.columns.sha)}
            <span className="header-label">{t('SHA')}</span>
          </div>
        </div>
        <div className="commit-rows" style={{ height: domHeight }}>
          {rows}
          <PassingLanes
            style={style}
            pages={pages}
            first={Math.max(first, offset) - offset}
            last={last - offset}
            top={Math.max(first, offset) * ROW_HEIGHT - virtualTop + viewport.top}
            left={layout.columns.refs}
            width={graphWidth}
            scroll={graphScroll}
            dimmed={Boolean(matches?.size)}
          />
        </div>
      </div>
      {maxGraphScroll > 0 && !empty && (
        <GraphScrollbar left={layout.columns.refs} width={graphWidth} content={lanesWidth} scroll={graphScroll} onScroll={(value) => setGraphScroll(Math.max(0, Math.min(maxGraphScroll, value)))} />
      )}
      {menu}
    </section>
  );
}

/** The bar under the graph column when its lanes are wider than it: drag the thumb to scroll sideways. */
function GraphScrollbar({ left, width, content, scroll, onScroll }: { left: number; width: number; content: number; scroll: number; onScroll(value: number): void }) {
  const ratio = width / content;
  return (
    <div className="graph-scrollbar" style={{ left, width }} role="scrollbar" aria-orientation="horizontal" aria-label={t('Scroll the graph sideways')} aria-valuenow={Math.round(scroll)} aria-valuemin={0} aria-valuemax={content - width}>
      <div
        className="graph-scrollbar-thumb"
        style={{ left: scroll * ratio, width: Math.max(16, width * ratio) }}
        onPointerDown={(event) => {
          event.preventDefault();
          const start = event.clientX;
          const from = scroll;
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          const move = (e: globalThis.PointerEvent) => onScroll(from + (e.clientX - start) / ratio);
          const up = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
          };
          target.addEventListener('pointermove', move);
          target.addEventListener('pointerup', up);
        }}
      />
    </div>
  );
}
