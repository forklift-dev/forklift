// Conflict blocks as git writes them into a file: <<<<<<< ours / (||||||| base) / ======= / >>>>>>> theirs.
import type { FileVersion } from './diff';

export interface ConflictBlock {
  /** 1-based line numbers of the `<<<<<<<` and `>>>>>>>` marker lines. */
  startLine: number;
  endLine: number;
  ours: string[];
  /** Present with merge.conflictStyle=diff3 or zdiff3. */
  base: string[] | null;
  theirs: string[];
  oursLabel: string;
  theirsLabel: string;
  /** 1-based line numbers of the ||||||| (or 0) and ======= markers. */
  baseLine: number;
  separatorLine: number;
}

export type ConflictChoice = 'ours' | 'theirs' | 'both' | 'theirs-ours' | 'base';

/** A safe automatic choice for a conflict block, or null when both sides changed differently. */
export function automaticChoice(block: ConflictBlock): ConflictChoice | null {
  const equal = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((line, index) => line === b[index]);
  const sameIgnoringWhitespace = (a: readonly string[], b: readonly string[]) => {
    const normalize = (lines: readonly string[]) => lines.map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n');
    return normalize(a) === normalize(b);
  };

  if (equal(block.ours, block.theirs)) return 'ours';
  if (block.base && equal(block.ours, block.base)) return 'theirs';
  if (block.base && equal(block.theirs, block.base)) return 'ours';
  if (block.base && sameIgnoringWhitespace(block.ours, block.base) && !sameIgnoringWhitespace(block.theirs, block.base)) return 'theirs';
  if (block.base && sameIgnoringWhitespace(block.theirs, block.base) && !sameIgnoringWhitespace(block.ours, block.base)) return 'ours';
  if (sameIgnoringWhitespace(block.ours, block.theirs)) return 'ours';
  return null;
}

const marker = (line: string, char: string) => line.startsWith(char.repeat(7)) && (line.length === 7 || line[7] === ' ' || line[7] === '\r');
const label = (line: string) => line.slice(8).replace(/\r$/, '');

/** Finds complete conflict blocks; an unfinished or malformed block is ignored (left as text). */
export function parseConflicts(text: string): ConflictBlock[] {
  const lines = text.split('\n');
  const blocks: ConflictBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!marker(lines[i]!, '<')) {
      i++;
      continue;
    }
    const start = i;
    const ours: string[] = [];
    let base: string[] | null = null;
    const theirs: string[] = [];
    let section: 'ours' | 'base' | 'theirs' = 'ours';
    let baseLine = 0;
    let separatorLine = 0;
    let end = -1;
    for (let j = start + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (marker(line, '<')) break; // a new block starts before this one ended: malformed
      if (section === 'ours' && marker(line, '|')) {
        section = 'base';
        base = [];
        baseLine = j + 1;
      } else if (section !== 'theirs' && marker(line, '=')) {
        section = 'theirs';
        separatorLine = j + 1;
      } else if (section === 'theirs' && marker(line, '>')) {
        end = j;
        break;
      } else {
        (section === 'ours' ? ours : section === 'base' ? base! : theirs).push(line);
      }
    }
    if (end < 0) {
      i = start + 1;
      continue;
    }
    blocks.push({
      startLine: start + 1,
      endLine: end + 1,
      ours,
      base,
      theirs,
      oursLabel: label(lines[start]!),
      theirsLabel: label(lines[end]!),
      baseLine,
      separatorLine,
    });
    i = end + 1;
  }
  return blocks;
}

/** The lines that replace a block for a choice. */
export function chosenLines(block: ConflictBlock, choice: ConflictChoice): string[] {
  switch (choice) {
    case 'ours':
      return block.ours;
    case 'theirs':
      return block.theirs;
    case 'both':
      return [...block.ours, ...block.theirs];
    case 'theirs-ours':
      return [...block.theirs, ...block.ours];
    case 'base':
      return block.base ?? [];
  }
}

/** Resolves one block in a text (for tests and whole-file actions; the editor applies the same edit with undo). */
export function resolveBlock(text: string, block: ConflictBlock, choice: ConflictChoice): string {
  const lines = text.split('\n');
  lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...chosenLines(block, choice));
  return lines.join('\n');
}


/** The versions of a conflicted file: from the index stages, and the working tree file with git's markers. */
export interface ConflictFile {
  path: string;
  /** Stage 1 (common ancestor); absent when both sides added the file. */
  base: FileVersion;
  /** Stage 2: the current branch (HEAD); during a rebase, the branch being rebased onto. */
  ours: FileVersion;
  /** Stage 3: what is being merged in (during a rebase: the commit being applied). */
  theirs: FileVersion;
  /** The working tree file. */
  merged: FileVersion;
}

export type ConflictSide = 'ours' | 'theirs';
export type OperationAction = 'continue' | 'abort' | 'skip';
