import type { FileDiff } from '../../../shared/diff';
import { changeLines, type LineAction, type LineActionRequest, type LineChange } from '../../../shared/staging';
import type { monaco } from './setup';

export type Side = 'original' | 'modified';

/** Lines covered by the editor's selections; a selection ending at column 1 does not include that line. */
export function selectedLines(editor: monaco.editor.ICodeEditor): Set<number> {
  const lines = new Set<number>();
  for (const selection of editor.getSelections() ?? []) {
    let end = selection.endLineNumber;
    if (end > selection.startLineNumber && selection.endColumn === 1) end--;
    for (let line = selection.startLineNumber; line <= end; line++) lines.add(line);
  }
  return lines;
}

/** The change a line of one side belongs to (a pure insertion/deletion counts at its anchor line). */
export function changeAt(changes: readonly LineChange[], side: Side, line: number): LineChange | undefined {
  return changes.find((change) => {
    const start = side === 'original' ? change.originalStartLineNumber : change.modifiedStartLineNumber;
    const end = side === 'original' ? change.originalEndLineNumber : change.modifiedEndLineNumber;
    return end === 0 ? Math.max(start, 1) === line : start <= line && line <= end;
  });
}

/** Line on the modified side where a change's hunk control is shown. */
export function anchorLine(change: LineChange): number {
  return change.modifiedEndLineNumber === 0 ? Math.max(change.modifiedStartLineNumber, 1) : change.modifiedStartLineNumber;
}

function request(action: LineAction, path: string, data: FileDiff, changes: LineChange[], original: number[], modified: number[]): LineActionRequest {
  return {
    action,
    path,
    originalHash: data.original.hash!,
    modifiedHash: data.modified.hash!,
    changes,
    selectedOriginal: original,
    selectedModified: modified,
  };
}

export function hunkRequest(action: LineAction, path: string, data: FileDiff, changes: LineChange[], change: LineChange): LineActionRequest {
  const lines = changeLines(change);
  return request(action, path, data, changes, lines.original, lines.modified);
}

/**
 * Picked lines: selected removed lines on the original side and selected added lines on the modified
 * side, limited to lines that are actually changed. Null when the selection touches no change.
 */
export function selectionRequest(
  action: LineAction,
  path: string,
  data: FileDiff,
  changes: LineChange[],
  selected: Record<Side, Set<number>>,
): LineActionRequest | null {
  const changed = changes.map(changeLines);
  const original = changed.flatMap((c) => c.original).filter((line) => selected.original.has(line));
  const modified = changed.flatMap((c) => c.modified).filter((line) => selected.modified.has(line));
  return original.length || modified.length ? request(action, path, data, changes, original, modified) : null;
}
