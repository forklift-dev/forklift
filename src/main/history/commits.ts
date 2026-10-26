/**
 * The shas and parents of a history, kept as bytes (20 per sha, 32 in SHA-256 repositories) in a few growing
 * buffers instead of a string per commit, with rows found by sha through an open-addressing table. For
 * linux's 1.5 million commits this is ~70 MB instead of several hundred MB of strings and a Map.
 */
export class CommitTable {
  length = 0;
  private shas: Buffer;
  /** Parents of all rows one after another; row i's are entries parentStart[i]…parentStart[i+1]. */
  private parentShas: Buffer;
  private parentStart: Uint32Array;
  private parentCount = 0;
  /** Row numbers by a hash of their sha (-1: empty), linear probing. */
  private slots: Int32Array;
  private readonly scratch: Buffer;

  constructor(
    /** Bytes per sha: 20 (SHA-1) or 32 (SHA-256). */
    readonly width = 20,
    capacity = 1024,
  ) {
    this.shas = Buffer.alloc(capacity * width);
    this.parentShas = Buffer.alloc(capacity * width);
    this.parentStart = new Uint32Array(capacity + 1);
    this.slots = new Int32Array(tableSize(capacity)).fill(-1);
    this.scratch = Buffer.alloc(width);
  }

  /** Appends a commit (`parents` space-separated, as rev-list prints them); returns its row. */
  add(hash: string, parents: string): number {
    const row = this.length;
    if ((row + 1) * this.width > this.shas.length) this.grow();
    this.shas.write(hash, row * this.width, this.width, 'hex');
    if (parents) {
      for (let at = 0; at < parents.length; at += this.width * 2 + 1) {
        if ((this.parentCount + 1) * this.width > this.parentShas.length) this.parentShas = resize(this.parentShas, Math.max(1024 * this.width, this.parentShas.length * 2));
        this.parentShas.write(parents.slice(at, at + this.width * 2), this.parentCount * this.width, this.width, 'hex');
        this.parentCount++;
      }
    }
    this.length = row + 1;
    this.parentStart[this.length] = this.parentCount;
    if (this.length * 2 > this.slots.length) this.rehash(this.slots.length * 2);
    else this.insert(row);
    return row;
  }

  hash(row: number): string {
    return this.shas.toString('hex', row * this.width, (row + 1) * this.width);
  }

  parents(row: number): string[] {
    const parents: string[] = [];
    for (let k = this.parentStart[row]!; k < this.parentStart[row + 1]!; k++) parents.push(this.parentShas.toString('hex', k * this.width, (k + 1) * this.width));
    return parents;
  }

  /** The row of a sha, or -1. */
  find(hash: string): number {
    if (hash.length !== this.width * 2 || !/^[0-9a-f]+$/i.test(hash)) return -1;
    this.scratch.write(hash, 0, this.width, 'hex');
    const mask = this.slots.length - 1;
    for (let slot = this.slotOf(this.scratch, 0); ; slot = (slot + 1) & mask) {
      const row = this.slots[slot]!;
      if (row < 0) return -1;
      if (this.shas.compare(this.scratch, 0, this.width, row * this.width, (row + 1) * this.width) === 0) return row;
    }
  }

  /** Gives back the room kept for growth (the history is complete; adding still works, it grows again). */
  trim(): void {
    this.shas = resize(this.shas, this.length * this.width);
    this.parentShas = resize(this.parentShas, this.parentCount * this.width);
    this.parentStart = this.parentStart.slice(0, this.length + 1);
  }

  /** The bytes as they are, to save (see restore). */
  parts(): CommitTableParts {
    return {
      width: this.width,
      length: this.length,
      shas: this.shas.subarray(0, this.length * this.width),
      parentShas: this.parentShas.subarray(0, this.parentCount * this.width),
      parentStart: this.parentStart.subarray(0, this.length + 1),
    };
  }

  static restore(parts: CommitTableParts): CommitTable {
    const table = new CommitTable(parts.width, Math.max(1, parts.length));
    table.shas = Buffer.from(parts.shas);
    table.parentShas = Buffer.from(parts.parentShas);
    table.parentStart = Uint32Array.from(parts.parentStart);
    table.parentCount = parts.parentShas.length / parts.width;
    table.length = parts.length;
    table.rehash(tableSize(parts.length));
    return table;
  }

  private insert(row: number): void {
    const mask = this.slots.length - 1;
    let slot = this.slotOf(this.shas, row * this.width);
    while (this.slots[slot]! >= 0) slot = (slot + 1) & mask;
    this.slots[slot] = row;
  }

  /** Where a sha's probing starts: its first and last words mixed (shas are uniform, but not always: tests, grafts). */
  private slotOf(buffer: Buffer, offset: number): number {
    const mixed = Math.imul(buffer.readUInt32LE(offset) ^ buffer.readUInt32LE(offset + this.width - 4), 0x9e3779b1) >>> 0;
    return mixed >>> (32 - Math.log2(this.slots.length));
  }

  private rehash(size: number): void {
    this.slots = new Int32Array(size).fill(-1);
    for (let row = 0; row < this.length; row++) this.insert(row);
  }

  private grow(): void {
    const capacity = Math.max(1024, (this.shas.length / this.width) * 2);
    this.shas = resize(this.shas, capacity * this.width);
    const start = new Uint32Array(capacity + 1);
    start.set(this.parentStart);
    this.parentStart = start;
  }
}

export interface CommitTableParts {
  width: number;
  length: number;
  shas: Uint8Array;
  parentShas: Uint8Array;
  parentStart: Uint32Array;
}

/** A power of two at least twice `count` (the table stays at most half full). */
const tableSize = (count: number) => 2 ** Math.ceil(Math.log2(Math.max(16, count * 2)));

/** A copy of `buffer` of `size` bytes, zero-filled when larger, cut when smaller. */
function resize(buffer: Buffer, size: number): Buffer {
  const larger = Buffer.alloc(size);
  buffer.copy(larger);
  return larger;
}
