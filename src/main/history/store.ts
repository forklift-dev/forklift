import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraphLayoutState } from '../../shared/graph';
import { CommitTable } from './commits';

/** What a history needs to be shown again without git: its shape, where stashes sit, and the saved layout states. */
export interface HistorySnapshot {
  version: string;
  filterKey: string;
  revisions: string[];
  commits: CommitTable;
  stashes: Array<[row: number, stash: StashSnapshot]>;
  checkpoints: GraphLayoutState[];
}

export interface StashSnapshot {
  hash: string;
  base: string;
  index: number;
  authorName: string;
  authorEmail: string;
  authorTime: number;
  subject: string;
}

const MAGIC = 'FKHIST2\n';

/**
 * Histories saved between runs (userData/history), so opening a large repository again shows its graph without
 * walking it: shas and parents as bytes, lanes as row numbers. One file per repository, the newest few kept.
 */
export class HistoryStore {
  constructor(
    private readonly dir: string,
    private readonly maxFiles = 8,
  ) {}

  /** The saved history of `root` when it is of exactly this version and filter, else null. */
  async load(root: string, version: string, filterKey: string): Promise<HistorySnapshot | null> {
    let data: Buffer;
    try {
      data = await readFile(this.file(root));
    } catch {
      return null;
    }
    try {
      const snapshot = decode(data);
      return snapshot.version === version && snapshot.filterKey === filterKey ? snapshot : null;
    } catch {
      return null; // damaged or from another format: rebuilt and saved again
    }
  }

  async save(root: string, snapshot: HistorySnapshot): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.file(root);
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, encode(snapshot));
    await rename(temporary, file);
    await this.prune();
  }

  private file(root: string): string {
    return join(this.dir, `${createHash('sha1').update(root).digest('hex')}.history`);
  }

  private async prune(): Promise<void> {
    const files = (await readdir(this.dir)).filter((name) => name.endsWith('.history'));
    if (files.length <= this.maxFiles) return;
    const dated = await Promise.all(files.map(async (name) => ({ name, time: (await stat(join(this.dir, name))).mtimeMs })));
    dated.sort((a, b) => b.time - a.time);
    await Promise.all(dated.slice(this.maxFiles).map(({ name }) => rm(join(this.dir, name), { force: true })));
  }
}

/**
 * Layout: MAGIC, a JSON header (version, filter, revisions, stashes, counts, lane shas that are not rows), then
 * the commit table as it is in memory: shas, parent shas (`width` bytes each) and where each row's parents start
 * (u32, little-endian, rows + 1 of them); then per checkpoint nextColor (i32), lane count (i32) and per lane the
 * waited sha (i32: a row, -1-k for the k-th outside sha, MIN_INT for a free lane) and its color (i32).
 */
export function encode(snapshot: HistorySnapshot): Buffer {
  const { commits } = snapshot;
  const outside: string[] = [];
  const outsideIndex = new Map<string, number>();
  const ref = (sha: string) => {
    const found = commits.find(sha);
    if (found >= 0) return found;
    let k = outsideIndex.get(sha);
    if (k === undefined) {
      k = outside.push(sha) - 1;
      outsideIndex.set(sha, k);
    }
    return -1 - k;
  };
  const lanes = snapshot.checkpoints.map((state) => state.lanes.map((lane) => (lane ? [ref(lane.sha), lane.color] : [NULL_LANE, 0])));
  const parts = commits.parts();
  const header = Buffer.from(
    JSON.stringify({
      version: snapshot.version,
      filterKey: snapshot.filterKey,
      revisions: snapshot.revisions,
      stashes: snapshot.stashes,
      width: parts.width,
      rows: parts.length,
      parents: parts.parentShas.length / parts.width,
      checkpoints: snapshot.checkpoints.length,
      outside,
    }),
  );
  const laneInts = lanes.reduce((sum, list) => sum + 2 + list.length * 2, 0);
  const size = MAGIC.length + 4 + header.length + parts.shas.length + parts.parentShas.length + parts.parentStart.byteLength + laneInts * 4;
  const buffer = Buffer.alloc(size);
  let at = buffer.write(MAGIC, 0, 'latin1');
  at = buffer.writeUInt32LE(header.length, at);
  at += header.copy(buffer, at);
  at += Buffer.from(parts.shas.buffer, parts.shas.byteOffset, parts.shas.length).copy(buffer, at);
  at += Buffer.from(parts.parentShas.buffer, parts.parentShas.byteOffset, parts.parentShas.length).copy(buffer, at);
  for (const start of parts.parentStart) at = buffer.writeUInt32LE(start, at);
  snapshot.checkpoints.forEach((state, i) => {
    at = buffer.writeInt32LE(state.nextColor, at);
    at = buffer.writeInt32LE(lanes[i]!.length, at);
    for (const [sha, color] of lanes[i]!) {
      at = buffer.writeInt32LE(sha!, at);
      at = buffer.writeInt32LE(color!, at);
    }
  });
  return buffer;
}

const NULL_LANE = -0x80000000;

export function decode(buffer: Buffer): HistorySnapshot {
  if (buffer.toString('latin1', 0, MAGIC.length) !== MAGIC) throw new Error('Not a saved history');
  let at = MAGIC.length;
  const headerLength = buffer.readUInt32LE(at);
  at += 4;
  const header = JSON.parse(buffer.toString('utf8', at, at + headerLength)) as {
    version: string;
    filterKey: string;
    revisions: string[];
    stashes: HistorySnapshot['stashes'];
    width: number;
    rows: number;
    parents: number;
    checkpoints: number;
    outside: string[];
  };
  at += headerLength;
  const take = (length: number) => {
    if (at + length > buffer.length) throw new Error('Saved history is cut short');
    const part = buffer.subarray(at, at + length);
    at += length;
    return part;
  };
  const shas = take(header.rows * header.width);
  const parentShas = take(header.parents * header.width);
  const starts = take((header.rows + 1) * 4);
  const parentStart = new Uint32Array(header.rows + 1);
  for (let i = 0; i <= header.rows; i++) parentStart[i] = starts.readUInt32LE(i * 4);
  if (parentStart[header.rows] !== header.parents) throw new Error('Saved history is inconsistent');
  const commits = CommitTable.restore({ width: header.width, length: header.rows, shas, parentShas, parentStart });
  const sha = (ref: number) => (ref >= 0 ? commits.hash(ref) : header.outside[-1 - ref]!);
  const checkpoints: GraphLayoutState[] = [];
  // Lanes are shared between states that carry the same one, as in memory (they are never changed in place).
  const laneObjects = new Map<string, { sha: string; color: number }>();
  for (let c = 0; c < header.checkpoints; c++) {
    const nextColor = buffer.readInt32LE(at);
    const count = buffer.readInt32LE(at + 4);
    at += 8;
    const lanes: ({ sha: string; color: number } | null)[] = [];
    for (let l = 0; l < count; l++, at += 8) {
      const ref = buffer.readInt32LE(at);
      if (ref === NULL_LANE) {
        lanes.push(null);
        continue;
      }
      const color = buffer.readInt32LE(at + 4);
      const key = `${ref}:${color}`;
      let lane = laneObjects.get(key);
      if (!lane) {
        lane = { sha: sha(ref), color };
        laneObjects.set(key, lane);
      }
      lanes.push(lane);
    }
    checkpoints.push({ lanes, nextColor });
  }
  if (at !== buffer.length) throw new Error('Saved history has trailing data');
  return { version: header.version, filterKey: header.filterKey, revisions: header.revisions, commits, stashes: header.stashes, checkpoints };
}
