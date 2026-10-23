import { useSyncExternalStore } from 'react';

// Sizes of the workspace's panels and the graph's columns, the same for every repository, kept in this
// window's storage (like the terminal's height) so they survive a restart.

export type ColumnId = 'refs' | 'graph' | 'author' | 'date' | 'sha';

export interface Layout {
  left: number;
  right: number;
  leftHidden: boolean;
  rightHidden: boolean;
  /** Column widths; `graph` null: as wide as the history's lanes. */
  columns: { refs: number; graph: number | null; author: number; date: number; sha: number };
  hidden: { author: boolean; date: boolean; sha: boolean };
}

export const DEFAULT_LAYOUT: Layout = {
  left: 220,
  right: 320,
  leftHidden: false,
  rightHidden: false,
  columns: { refs: 170, graph: null, author: 140, date: 150, sha: 80 },
  hidden: { author: false, date: false, sha: false },
};

export const LIMITS = {
  left: [160, 520],
  right: [240, 720],
  refs: [60, 400],
  graph: [40, 800],
  author: [60, 320],
  date: [80, 260],
  sha: [60, 160],
} as const;

const KEY = 'forklift.layout';
const clamp = (value: number, [min, max]: readonly [number, number]) => Math.round(Math.min(max, Math.max(min, value)));

function load(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Layout> | null;
    if (!saved || typeof saved !== 'object') return DEFAULT_LAYOUT;
    return {
      ...DEFAULT_LAYOUT,
      ...saved,
      columns: { ...DEFAULT_LAYOUT.columns, ...saved.columns },
      hidden: { ...DEFAULT_LAYOUT.hidden, ...saved.hidden },
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

let layout = load();
const listeners = new Set<() => void>();

function update(change: (current: Layout) => Layout): void {
  layout = change(layout);
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // not kept: fine
  }
  for (const listener of listeners) listener();
}

export function useLayout(): Layout {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => layout,
  );
}

export const setPanelWidth = (side: 'left' | 'right', width: number) => update((current) => ({ ...current, [side]: clamp(width, LIMITS[side]), [`${side}Hidden`]: false }));
export const resetPanelWidth = (side: 'left' | 'right') => update((current) => ({ ...current, [side]: DEFAULT_LAYOUT[side], [`${side}Hidden`]: false }));
export const togglePanel = (side: 'left' | 'right') => update((current) => ({ ...current, [`${side}Hidden`]: !current[`${side}Hidden`] }));

export const setColumnWidth = (column: ColumnId, width: number | null) =>
  update((current) => ({ ...current, columns: { ...current.columns, [column]: width === null ? null : clamp(width, LIMITS[column]) } }));
export const resetColumns = () => update((current) => ({ ...current, columns: DEFAULT_LAYOUT.columns, hidden: DEFAULT_LAYOUT.hidden }));
export const toggleColumn = (column: keyof Layout['hidden']) => update((current) => ({ ...current, hidden: { ...current.hidden, [column]: !current.hidden[column] } }));
