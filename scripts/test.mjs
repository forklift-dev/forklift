// Runs Vitest inside Electron's Node runtime: native modules are compiled for Electron's ABI,
// so loading them from plain Node would fail.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
// The CLI entry is not in vitest's "exports", so resolve it through the package's bin field.
const vitestPackage = require.resolve('vitest/package.json');
const vitestCli = join(dirname(vitestPackage), require(vitestPackage).bin.vitest);

const result = spawnSync(electronBinary, [vitestCli, 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(result.status ?? 1);
