// Test helper: a plain LCS line diff reported in Monaco's LineChange format.
import type { LineChange } from '../../shared/staging';
import { splitLines } from './partial';

export function lcsChanges(a: string[], b: string[]): LineChange[] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const changes: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const i0 = i;
    const j0 = j;
    while ((i < n || j < m) && !(i < n && j < m && a[i] === b[j])) {
      if (j >= m || (i < n && dp[i + 1]![j]! >= dp[i]![j + 1]!)) i++;
      else j++;
    }
    changes.push({
      originalStartLineNumber: i > i0 ? i0 + 1 : i0,
      originalEndLineNumber: i > i0 ? i : 0,
      modifiedStartLineNumber: j > j0 ? j0 + 1 : j0,
      modifiedEndLineNumber: j > j0 ? j : 0,
    });
  }
  return changes;
}

/** Changes between two texts, the way the diff editor would report them. */
export function textChanges(original: string, modified: string): LineChange[] {
  return lcsChanges(splitLines(original).lines, splitLines(modified).lines);
}
