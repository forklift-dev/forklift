// Partial staging contract: the window sends the changes exactly as its diff editor computed them,
// plus which of their lines the user picked; main rebuilds the file from the same two texts.

/** A changed block as Monaco reports it (1-based; `*EndLineNumber === 0` marks an insertion/deletion point). */
export interface LineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

/**
 * stage: index ↔ working tree view, put the picked lines into the index.
 * unstage: HEAD ↔ index view, take the picked lines out of the index.
 * discard: index ↔ working tree view, revert the picked lines in the working tree.
 */
export type LineAction = 'stage' | 'unstage' | 'discard';

/** A change as 0-based line ranges; an empty range marks an insertion/deletion point. */
export interface ChangeBlock {
  origStart: number;
  origCount: number;
  modStart: number;
  modCount: number;
}

export function toBlock(change: LineChange): ChangeBlock {
  const insertion = change.originalEndLineNumber === 0;
  const deletion = change.modifiedEndLineNumber === 0;
  return {
    origStart: insertion ? change.originalStartLineNumber : change.originalStartLineNumber - 1,
    origCount: insertion ? 0 : change.originalEndLineNumber - change.originalStartLineNumber + 1,
    modStart: deletion ? change.modifiedStartLineNumber : change.modifiedStartLineNumber - 1,
    modCount: deletion ? 0 : change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1,
  };
}

/** 1-based lines of a change on each side: what picking "the whole hunk" means. */
export function changeLines(change: LineChange): { original: number[]; modified: number[] } {
  const block = toBlock(change);
  return {
    original: Array.from({ length: block.origCount }, (_, i) => block.origStart + i + 1),
    modified: Array.from({ length: block.modCount }, (_, i) => block.modStart + i + 1),
  };
}

export interface LineActionRequest {
  action: LineAction;
  path: string;
  /** `hash` of both FileDiff versions the changes were computed on; a mismatch means the view is stale. */
  originalHash: string;
  modifiedHash: string;
  changes: LineChange[];
  /** 1-based lines on the original side whose removal is picked. */
  selectedOriginal: number[];
  /** 1-based lines on the modified side whose addition is picked. */
  selectedModified: number[];
}
