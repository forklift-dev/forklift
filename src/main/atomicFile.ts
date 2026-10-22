import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes a small file atomically (temporary file + rename, so a crash never leaves half a file).
 * Writes are serialized; when several are queued only the latest content is written.
 */
export class AtomicFile {
  private queue: Promise<void> = Promise.resolve();
  private pending: string | null = null;

  constructor(readonly path: string) {}

  write(text: string): Promise<void> {
    this.pending = text;
    const write = this.queue.then(() => this.flush());
    this.queue = write.catch(() => {}); // a failed write must not block later ones
    return write;
  }

  private async flush(): Promise<void> {
    const text = this.pending;
    if (text === null) return;
    this.pending = null;
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(temp, text, { encoding: 'utf8', flush: true });
      await rename(temp, this.path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }
}
