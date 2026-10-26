import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraphLayoutState } from '../../shared/graph';

/** What a history needs to be shown again without git: its shape, where stashes sit, and the saved layout states. */
export interface HistorySnapshot {
  version: string;
  filterKey: string;
  revisions: string[];
  hashes: string[];
  /** Parent hashes joined by spaces, as kept in memory. */
  parentLists: string[];
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

const MAGIC = 'FKHIST1\n';

/**
 * Histories saved between runs (userData/history), so opening a large repository again shows its graph without
 * walking it: shas as 20 bytes, parents and lanes as row numbers. One file per repository, the newest few kept.
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
 * Layout: MAGIC, a JSON header (version, filter, revisions, stashes, counts, shas that are not rows), then
 * little-endian binary: 20-byte shas of the rows; per row the parent count (u8) and parents (i32: a row number,
 * or -1-k for the k-th outside sha); per checkpoint nextColor (i32), lane count (i32) and per lane the waited
 * sha (i32 as parents, or MIN_INT for a free lane) and its color (i32).
 */
export function encode(snapshot: HistorySnapshot): Buffer {
  const row = new Map(snapshot.hashes.map((hash, i) => [hash, i]));
  const outside: string[] = [];
  const outsideIndex = new Map<string, number>();
  const ref = (sha: string) => {
    const found = row.get(sha);
    if (found !== undefined) return found;
    let k = outsideIndex.get(sha);
    if (k === undefined) {
      k = outside.push(sha) - 1;
      outsideIndex.set(sha, k);
    }
    return -1 - k;
  };
  const parents = snapshot.parentLists.map((list) => (list ? list.split(' ').map(ref) : []));
  const lanes = snapshot.checkpoints.map((state) => state.lanes.map((lane) => (lane ? [ref(lane.sha), lane.color] : [NULL_LANE, 0])));
  const header = Buffer.from(
    JSON.stringify({
      version: snapshot.version,
      filterKey: snapshot.filterKey,
      revisions: snapshot.revisions,
      stashes: snapshot.stashes,
      rows: snapshot.hashes.length,
      checkpoints: snapshot.checkpoints.length,
      outside,
    }),
  );
  const parentInts = parents.reduce((sum, list) => sum + list.length, 0);
  const laneInts = lanes.reduce((sum, list) => sum + 2 + list.length * 2, 0);
  const size = MAGIC.length + 4 + header.length + snapshot.hashes.length * 21 + (parentInts + laneInts) * 4;
  const buffer = Buffer.alloc(size);
  let at = buffer.write(MAGIC, 0, 'latin1');
  at = buffer.writeUInt32LE(header.length, at);
  at += header.copy(buffer, at);
  for (const hash of snapshot.hashes) at += buffer.write(hash, at, 20, 'hex');
  for (const list of parents) {
    at = buffer.writeUInt8(list.length, at);
    for (const parent of list) at = buffer.writeInt32LE(parent, at);
  }
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
    rows: number;
    checkpoints: number;
    outside: string[];
  };
  at += headerLength;
  const hashes = new Array<string>(header.rows);
  for (let i = 0; i < header.rows; i++, at += 20) hashes[i] = buffer.toString('hex', at, at + 20);
  const sha = (ref: number) => (ref >= 0 ? hashes[ref]! : header.outside[-1 - ref]!);
  const parentLists = new Array<string>(header.rows);
  for (let i = 0; i < header.rows; i++) {
    const count = buffer.readUInt8(at++);
    let list = '';
    for (let p = 0; p < count; p++, at += 4) list += (p ? ' ' : '') + sha(buffer.readInt32LE(at));
    parentLists[i] = list;
  }
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
  return { version: header.version, filterKey: header.filterKey, revisions: header.revisions, hashes, parentLists, stashes: header.stashes, checkpoints };
}
