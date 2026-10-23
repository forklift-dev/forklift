import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react';
import { EdgeKind, type GraphRowLayout } from '../../../shared/graph';
import type { HistoryRow } from '../../../shared/history';
import type { RepoData } from '../../../shared/state';
import { historyPages } from '../history';

export const ROW_HEIGHT = 28;
const LANE_WIDTH = 14;
const MAX_GRAPH_LANES = 16;
const OVERSCAN = 20;
const NODE_RADIUS = 5;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const laneX = (lane: number) => LANE_WIDTH / 2 + lane * LANE_WIDTH;

/** One row of the graph: lines through the row and the commit's node. */
function GraphCell({ layout, width, merge, wipAbove }: { layout: GraphRowLayout; width: number; merge: boolean; wipAbove: boolean }) {
  const mid = ROW_HEIGHT / 2;
  const x = laneX(layout.column);
  return (
    <svg className="graph-cell" width={width} height={ROW_HEIGHT} aria-hidden="true">
      {layout.edges.map((edge, index) => {
        const from = laneX(edge.from);
        const to = laneX(edge.to);
        let d: string;
        if (edge.kind === EdgeKind.Pass) d = `M${from} 0V${ROW_HEIGHT}`;
        else if (edge.kind === EdgeKind.In) d = from === to ? `M${from} 0V${mid}` : `M${from} 0C${from} ${mid * 0.6} ${to} ${mid * 0.4} ${to} ${mid}`;
        else d = from === to ? `M${from} ${mid}V${ROW_HEIGHT}` : `M${from} ${mid}C${from} ${mid * 1.6} ${to} ${mid * 1.4} ${to} ${ROW_HEIGHT}`;
        return <path key={index} d={d} className={`edge lane-${edge.color % 10}`} />;
      })}
      {wipAbove && <path d={`M${x} 0V${mid}`} className={`edge wip-edge lane-${layout.color % 10}`} />}
      <circle cx={x} cy={mid} r={merge ? NODE_RADIUS - 1.5 : NODE_RADIUS} className={`node lane-${layout.color % 10}${merge ? ' merge' : ''}`} />
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
          </span>
        );
      })}
    </>
  );
}

interface CommitGraphProps {
  repo: string;
  data: RepoData;
  /** null: the working tree (WIP row) is selected. */
  selectedHash: string | null;
  onSelect(hash: string | null): void;
  onContextMenu?(event: MouseEvent, row: HistoryRow): void;
}

/**
 * The history list with its graph, virtualized: only rows in view are rendered and history pages are
 * fetched from main as they come into view. A "WIP" row on top stands for uncommitted changes.
 */
export function CommitGraph({ repo, data, selectedHash, onSelect, onContextMenu }: CommitGraphProps) {
  const pages = historyPages(repo, data.historyVersion);
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
  const first = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(total - 1, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN);

  useEffect(() => {
    pages.request(first - offset, Math.max(0, last - offset));
  }, [pages, first, last, offset]);

  const lanes = Math.min(MAX_GRAPH_LANES, Math.max(pages.maxWidth, 1));
  const graphWidth = lanes * LANE_WIDTH + 4;
  const headIsFirst = pages.row(0)?.hash === data.branch.oid;
  const staged = data.changes.filter((change) => change.staged).length;
  const unstaged = data.changes.filter((change) => change.unstaged).length;

  const select = (index: number) => {
    if (index < offset) return onSelect(null);
    const row = pages.row(index - offset);
    if (row) onSelect(row.hash);
  };

  const selectedIndex = selectedHash ? pages.indexOf(selectedHash) + offset : wip ? 0 : -1;

  // A commit selected from elsewhere (a branch in the left panel) is scrolled into view once.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedHash || revealed.current === selectedHash || selectedIndex < offset) return;
    revealed.current = selectedHash;
    const element = scrollRef.current;
    if (!element) return;
    const top = selectedIndex * ROW_HEIGHT;
    if (top < element.scrollTop || top + 2 * ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 3);
    }
  }, [selectedHash, selectedIndex, offset]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = Math.max(0, Math.min(total - 1, (selectedIndex < 0 ? -1 : selectedIndex) + (event.key === 'ArrowDown' ? 1 : -1)));
    select(next);
    // Rows start below the sticky header (one row high), so row `next` spans content y (next+1)…(next+2) rows.
    const element = scrollRef.current!;
    const top = next * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + 2 * ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + 2 * ROW_HEIGHT - element.clientHeight;
  };

  const rows = [];
  for (let index = first; index <= last; index++) {
    const style = { transform: `translateY(${index * ROW_HEIGHT}px)` };
    if (index < offset) {
      const column = headIsFirst ? (pages.row(0)?.graph.column ?? 0) : 0;
      rows.push(
        <div key="wip" role="row" aria-selected={selectedHash === null} className={`commit-row wip${selectedHash === null ? ' selected' : ''}`} style={style} onClick={() => onSelect(null)}>
          <div className="cell refs" />
          <div className="cell graph" style={{ width: graphWidth }}>
            <svg className="graph-cell" width={graphWidth} height={ROW_HEIGHT} aria-hidden="true">
              {headIsFirst && <path d={`M${laneX(column)} ${ROW_HEIGHT / 2}V${ROW_HEIGHT}`} className="edge wip-edge" />}
              <circle cx={laneX(column)} cy={ROW_HEIGHT / 2} r={NODE_RADIUS} className="node wip-node" />
            </svg>
          </div>
          <div className="cell message">
            <span className="wip-label">{'// WIP'}</span>
            <span className="wip-counts">
              {staged > 0 && `${staged} staged`}
              {staged > 0 && unstaged > 0 && ', '}
              {unstaged > 0 && `${unstaged} unstaged`}
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
      rows.push(<div key={`placeholder-${index}`} className="commit-row placeholder" style={style} aria-hidden="true" />);
      continue;
    }
    const selected = row.hash === selectedHash;
    rows.push(
      <div
        key={row.hash}
        role="row"
        aria-selected={selected}
        className={`commit-row${selected ? ' selected' : ''}`}
        style={style}
        data-hash={row.hash}
        onClick={() => onSelect(row.hash)}
        onContextMenu={onContextMenu && ((event) => onContextMenu(event, row))}
      >
        <div className="cell refs">
          <RefBadges labels={data.refs[row.hash]} />
        </div>
        <div className="cell graph" style={{ width: graphWidth }}>
          <GraphCell layout={row.graph} width={graphWidth} merge={row.parents.length > 1} wipAbove={wip && index === offset && row.hash === data.branch.oid} />
        </div>
        <div className="cell message subject" title={row.subject}>
          {row.subject}
        </div>
        <div className="cell author" title={row.authorEmail}>
          {row.authorName}
        </div>
        <div className="cell date">{dateFormat.format(row.authorTime * 1000)}</div>
        <div className="cell sha">{row.hash.slice(0, 7)}</div>
      </div>,
    );
  }

  const empty = pages.complete && pages.loaded === 0 && !wip;
  return (
    <section className="commits" aria-label="Commit history">
      {pages.error && <div className="diff-message error">{pages.error}</div>}
      {empty && <div className="empty-note">No commits yet</div>}
      <div className="commit-scroll" ref={scrollRef} role="grid" aria-rowcount={total} tabIndex={0} onKeyDown={onKeyDown} hidden={empty}>
        {/* Inside the scroll area (sticky), so its columns line up with the rows beside the scrollbar. */}
        <div className="commit-header" role="row">
          <div className="cell refs">Branch / Tag</div>
          <div className="cell graph" style={{ width: graphWidth }}>
            Graph
          </div>
          <div className="cell message">Commit message</div>
          <div className="cell author">Author</div>
          <div className="cell date">Date</div>
          <div className="cell sha">SHA</div>
        </div>
        <div className="commit-rows" style={{ height: total * ROW_HEIGHT }}>
          {rows}
        </div>
      </div>
    </section>
  );
}
