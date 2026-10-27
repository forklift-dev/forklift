import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_DIFF_DISPLAY_CHARS } from '../../shared/diff';
import { readToolVersion } from './toolFile';

describe('readToolVersion', () => {
  const folders: string[] = [];
  const file = (contents: Buffer | string) => {
    const folder = mkdtempSync(join(tmpdir(), 'forklift-tool-file-'));
    folders.push(folder);
    const path = join(folder, 'file.txt');
    writeFileSync(path, contents);
    return path;
  };
  afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

  it('preserves a UTF-8 BOM through text round-trip', async () => {
    const path = file(Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
    const version = await readToolVersion(path);
    expect(version.text).toBe('\ufeffa');
    expect(Buffer.from(version.text!, 'utf8')).toEqual(Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
  });

  it('limits the text passed to an editor and marks it incomplete', async () => {
    const version = await readToolVersion(file(`start${'x'.repeat(MAX_DIFF_DISPLAY_CHARS)}`));
    expect(version.truncated).toBe(true);
    expect(version.text?.length).toBe(MAX_DIFF_DISPLAY_CHARS);
  });
});
