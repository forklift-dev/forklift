// Verifies that the release AppImage uses electron-builder's static runtime rather than the legacy
// runtime that dlopens libfuse.so.2. Run on Linux after packaging.
import { execFileSync, spawnSync } from 'node:child_process';
import { openSync, readFileSync, readSync, readdirSync, closeSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

if (process.platform !== 'linux') {
  console.log('AppImage runtime check skipped outside Linux');
  process.exit(0);
}

const dist = resolve(import.meta.dirname, '..', 'dist');
const { productName, version } = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'));
const names = readdirSync(dist).filter((name) => name.startsWith(`${productName}-${version}`) && name.endsWith('.AppImage'));
if (names.length !== 1) {
  console.error(`Expected one AppImage for version ${version} in ${dist}, found ${names.length}`);
  process.exit(1);
}

const image = join(dist, names[0]);
const description = execFileSync('file', ['--brief', image], { encoding: 'utf8' }).trim();
if (!/static-pie linked/.test(description)) {
  console.error(`${basename(image)} does not use a static-PIE runtime: ${description}`);
  process.exit(1);
}

const offsetText = execFileSync(image, ['--appimage-offset'], { encoding: 'utf8' }).trim();
const offset = Number(offsetText);
if (!Number.isSafeInteger(offset) || offset <= 0 || offset > 16 * 1024 * 1024) {
  console.error(`${basename(image)} reported an invalid runtime size: ${offsetText}`);
  process.exit(1);
}

const runtime = Buffer.alloc(offset);
const fd = openSync(image, 'r');
try {
  let read = 0;
  while (read < runtime.length) {
    const count = readSync(fd, runtime, read, runtime.length - read, read);
    if (count === 0) throw new Error('Could not read the complete AppImage runtime');
    read += count;
  }
} finally {
  closeSync(fd);
}

const text = runtime.toString('latin1');
if (text.includes('libfuse.so.2')) {
  console.error(`${basename(image)} runtime still dynamically loads libfuse.so.2`);
  process.exit(1);
}
if (!text.includes('squashfuse')) {
  console.error(`${basename(image)} runtime does not contain the expected built-in squashfuse`);
  process.exit(1);
}

const versionResult = spawnSync(image, ['--appimage-version'], { encoding: 'utf8' });
if (versionResult.status !== 0) {
  console.error(`${basename(image)} could not report its runtime version: ${versionResult.stderr || versionResult.stdout}`);
  process.exit(1);
}
const runtimeVersion = `${versionResult.stdout}${versionResult.stderr}`.trim();
console.log(`${basename(image)}: ${description}`);
console.log(`${basename(image)}: runtime ${offset} bytes; ${runtimeVersion}; no external libfuse.so.2`);
