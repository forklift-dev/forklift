// Fuzzy matching for the palette and the finder, in the spirit of fuzzaldrin: the query's characters in
// order, preferring word starts, runs of consecutive characters and (for paths) the file name.

export interface FuzzyMatch {
  score: number;
  /** Indices in the text of the matched characters, for highlighting. */
  positions: number[];
}

const SEPARATORS = new Set(['/', '\\', '_', '-', '.', ' ', ':', '(', ')']);

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1]!;
  if (SEPARATORS.has(previous)) return true;
  const current = text[index]!;
  return previous === previous.toLowerCase() && current !== current.toLowerCase();
}

/** Scores `text` for `query` (spaces in the query are ignored); null when the characters are not all there in order. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return { score: 0, positions: [] };
  const t = text.toLowerCase();
  const n = q.length;
  const m = t.length;
  if (n > m) return null;
  // Quick rejection: the characters in order at all.
  for (let i = 0, j = 0; i < n; i++, j++) {
    j = t.indexOf(q[i]!, j);
    if (j < 0) return null;
  }

  // best[i][j]: best score with q[i] matched at t[j]; from[i][j]: where q[i-1] was matched.
  const best: Float64Array[] = [];
  const from: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(m).fill(-Infinity);
    const back = new Int32Array(m).fill(-1);
    for (let j = i; j < m; j++) {
      if (t[j] !== q[i]) continue;
      const bonus = (j === 0 ? 3 : 0) + (isBoundary(text, j) ? 6 : 0) + (text[j] === query[i] ? 0.1 : 0);
      if (i === 0) {
        row[j] = 1 + bonus - Math.min(j, 20) * 0.05;
        continue;
      }
      const previous = best[i - 1]!;
      let top = -Infinity;
      let at = -1;
      for (let k = i - 1; k < j; k++) {
        if (previous[k] === -Infinity) continue;
        const gap = j - k - 1;
        const value = previous[k]! + (gap === 0 ? 5 : -Math.min(gap, 10) * 0.2);
        if (value > top) {
          top = value;
          at = k;
        }
      }
      if (at >= 0) {
        row[j] = top + 1 + bonus;
        back[j] = at;
      }
    }
    best.push(row);
    from.push(back);
  }
  let end = -1;
  let score = -Infinity;
  for (let j = 0; j < m; j++) {
    if (best[n - 1]![j]! > score) {
      score = best[n - 1]![j]!;
      end = j;
    }
  }
  if (end < 0) return null;
  const positions: number[] = [];
  for (let i = n - 1, j = end; i >= 0; j = from[i]![j]!, i--) positions.unshift(j);
  // Shorter texts win ties; a match inside the file name beats one spread over the folders.
  const slash = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  const inName = slash >= 0 && positions[0]! > slash ? 4 : 0;
  return { score: score + inName - m * 0.01, positions };
}

/** The best `limit` items for the query, best first (all, in order, for an empty query). */
export function fuzzyFilter<T>(query: string, items: readonly T[], text: (item: T) => string, limit = 100): Array<{ item: T } & FuzzyMatch> {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, score: 0, positions: [] }));
  const found: Array<{ item: T } & FuzzyMatch> = [];
  for (const item of items) {
    const match = fuzzyMatch(query, text(item));
    if (match) found.push({ item, ...match });
  }
  return found.sort((a, b) => b.score - a.score).slice(0, limit);
}
