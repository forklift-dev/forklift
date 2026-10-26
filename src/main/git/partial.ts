import { toBlock, type LineChange } from '../../shared/staging';
import { t } from '../../shared/i18n';

/** Lines the way Monaco models them: split on \r\n, \r or \n; a trailing newline leaves an empty last line. */
interface SplitText {
  lines: string[];
  /** eols[i] follows lines[i]; the last line has none. */
  eols: string[];
}

export function splitLines(text: string): SplitText {
  const lines: string[] = [];
  const eols: string[] = [];
  const pattern = /\r\n|\r|\n/g;
  let start = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    lines.push(text.slice(start, match.index));
    eols.push(match[0]);
    start = match.index + match[0].length;
  }
  lines.push(text.slice(start));
  eols.push('');
  return { lines, eols };
}

export function dominantEol({ eols }: { eols: string[] }): string | null {
  const counts = new Map<string, number>();
  for (const eol of eols) if (eol) counts.set(eol, (counts.get(eol) ?? 0) + 1);
  let best: string | null = null;
  for (const [eol, count] of counts) if (best === null || count > counts.get(best)!) best = eol;
  return best;
}

export class PartialApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartialApplyError';
  }
}

export interface LinePicker {
  /** Apply the removal of this 1-based original line? */
  original(line: number): boolean;
  /** Apply the addition of this 1-based modified line? */
  modified(line: number): boolean;
}

/**
 * Rebuilds `original` with some of the changes that turn it into `modified` applied, line by line.
 * Lines keep their own end-of-line sequence. The changes must describe these exact texts: everything
 * outside them has to match, otherwise (stale view, whitespace-insensitive diff) nothing is applied.
 */
export function applyLineChanges(
  original: string,
  modified: string,
  changes: readonly LineChange[],
  pick: LinePicker,
  /** EOL for lines coming from the original side, e.g. CRLF when reverting index (LF) lines into a CRLF checkout. */
  originalEol?: string,
): string {
  const orig = splitLines(original);
  const mod = splitLines(modified);
  const out: Array<{ text: string; eol: string }> = [];

  let o = 0;
  let m = 0;
  const copyUnchanged = (count: number) => {
    for (let i = 0; i < count; i++, o++, m++) {
      if (orig.lines[o] !== mod.lines[m]) {
        throw new PartialApplyError(t('Line {line} differs outside the reported changes; the diff is out of date', { line: o + 1 }));
      }
      out.push({ text: orig.lines[o]!, eol: originalEol && orig.eols[o] ? originalEol : orig.eols[o]! });
    }
  };

  for (const block of changes.map(toBlock)) {
    const before = block.origStart - o;
    if (before < 0 || block.modStart - m !== before || block.origCount < 0 || block.modCount < 0) {
      throw new PartialApplyError(t('Changes are out of order or do not match the file'));
    }
    copyUnchanged(before);
    if (o + block.origCount > orig.lines.length || m + block.modCount > mod.lines.length) {
      throw new PartialApplyError(t('A change reaches past the end of the file'));
    }
    // Removals that are not picked stay; picked additions follow, as in `git add -p` edits.
    for (let i = 0; i < block.origCount; i++, o++) {
      if (!pick.original(o + 1)) out.push({ text: orig.lines[o]!, eol: originalEol && orig.eols[o] ? originalEol : orig.eols[o]! });
    }
    for (let i = 0; i < block.modCount; i++, m++) {
      if (pick.modified(m + 1)) out.push({ text: mod.lines[m]!, eol: mod.eols[m]! });
    }
  }
  if (orig.lines.length - o !== mod.lines.length - m) throw new PartialApplyError(t('Changes do not cover the end of the file'));
  copyUnchanged(orig.lines.length - o);

  // A line that was last in its file has no EOL of its own; when something follows it now, it needs one.
  const fallback = dominantEol(mod) ?? dominantEol(orig) ?? '\n';
  return out.map((line, i) => line.text + (i < out.length - 1 ? line.eol || fallback : '')).join('');
}
