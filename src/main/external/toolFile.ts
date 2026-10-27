import { lstat, open } from 'node:fs/promises';
import { MAX_DIFF_DISPLAY_CHARS, MAX_DIFF_FILE_BYTES, type FileVersion } from '../../shared/diff';

/** Read only the prefix that an isolated Git tool can safely show in Monaco. */
export async function readToolVersion(path: string): Promise<FileVersion> {
  const missing = { path, exists: false, binary: false, tooLarge: false, size: 0, text: null, lossy: false, hash: null } satisfies FileVersion;
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!info) return missing;
  if (!info.isFile()) throw new Error('Git diff side is not a regular file');
  if (info.size > MAX_DIFF_FILE_BYTES) return { ...missing, exists: true, tooLarge: true, size: info.size };

  const limit = Math.min(info.size, MAX_DIFF_DISPLAY_CHARS + 4);
  const bytes = Buffer.allocUnsafe(limit);
  const file = await open(path, 'r');
  let read = 0;
  try {
    while (read < limit) {
      const chunk = await file.read(bytes, read, limit - read, read);
      if (chunk.bytesRead === 0) break;
      read += chunk.bytesRead;
    }
  } finally {
    await file.close();
  }
  const content = bytes.subarray(0, read);
  const binary = content.subarray(0, 8000).includes(0);
  const prefixOnly = info.size > read;
  if (binary) return { ...missing, exists: true, binary: true, size: info.size };

  // ignoreBOM=true keeps U+FEFF in the text, so saving it writes the same BOM bytes.
  let text: string;
  let lossy = false;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); }
  catch {
    text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(content);
    lossy = !prefixOnly;
  }
  const visible = text.slice(0, MAX_DIFF_DISPLAY_CHARS);
  return { path, exists: true, binary: false, tooLarge: false, size: info.size, text: visible, truncated: prefixOnly || visible.length < text.length, lossy, hash: null };
}
