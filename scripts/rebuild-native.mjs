// Rebuilds native modules from source against the installed Electron's headers.
// nodegit has no prebuilt binaries for current Electron releases, so every platform
// (and every CPU architecture) compiles it locally or on its own CI runner.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { rebuild } from '@electron/rebuild';

const require = createRequire(import.meta.url);
const projectDir = resolve(import.meta.dirname, '..');
const electronVersion = require('electron/package.json').version;
const nodegitDir = dirname(require.resolve('@axosoft/nodegit/package.json'));
const openSSLDir = join(nodegitDir, 'vendor', 'openssl');
const force = process.argv.includes('--force');

// V8 in Electron 45+ requires a pointer tag in v8::External::Value(). nan >= 2.28 (pinned via
// package.json "overrides") handles its own calls and exposes Nan::GetExternalValue(), which
// picks the right signature for the V8 it is compiled against; nodegit's generated sources
// still call ->Value() directly, so rewrite those exact forms. Idempotent.
const EXTERNAL_VALUE_REWRITES = [
  ['info.Data().As<External>()->Value()', 'Nan::GetExternalValue(info.Data().As<External>())'],
  ['Local<External>::Cast(info[0])->Value()', 'Nan::GetExternalValue(Local<External>::Cast(info[0]))'],
  ['External::Cast(*info[0])->Value()', 'Nan::GetExternalValue(info[0].As<External>())'],
];
let patchedFiles = 0;
for (const sourceDir of ['src', 'include']) {
  for (const entry of readdirSync(join(nodegitDir, sourceDir), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(cc|h)$/.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    const source = readFileSync(file, 'utf8');
    let patched = source;
    for (const [from, to] of EXTERNAL_VALUE_REWRITES) patched = patched.replaceAll(from, to);
    if (patched !== source) {
      writeFileSync(file, patched);
      patchedFiles += 1;
    }
  }
}
if (patchedFiles > 0) console.log(`Patched v8::External::Value() calls in ${patchedFiles} nodegit sources`);

// OpenSSL is built from source on Linux and downloaded prebuilt on macOS/Windows by nodegit's
// own script. We run it once up front instead of letting the gyp graph do it, because:
// - parallel compile jobs do not wait for that gyp action ("openssl/des.h: No such file");
// - its version check misparses 3.0.18 as 3.0.1 and rebuilds OpenSSL on every run.
if (force || !existsSync(join(openSSLDir, 'include', 'openssl', 'ssl.h'))) {
  const result = spawnSync(process.execPath, [join(nodegitDir, 'utils', 'acquireOpenSSL.mjs')], {
    cwd: nodegitDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Inherited by node-gyp: a preset OpenSSL dir makes nodegit skip its own acquire action.
process.env.npm_config_openssl_dir = openSSLDir;
// Link OpenSSL statically on Linux too, so the app does not depend on the distro's libssl version.
process.env.NODEGIT_OPENSSL_STATIC_LINK = '1';

await rebuild({
  buildPath: projectDir,
  electronVersion,
  onlyModules: ['@axosoft/nodegit', 'nsfw', 'find-git-repositories'],
  buildFromSource: true,
  force,
  jobs: availableParallelism(),
});

// The nodegit fork's Linux loader prefers these prebuilt variants (downloaded for plain Node
// during npm install) over our Electron build; remove them so only the Electron build ships.
const releaseDir = join(nodegitDir, 'build', 'Release');
for (const file of readdirSync(releaseDir)) {
  if (/^nodegit-.+-ubuntu-\d+.*\.node$/.test(file)) rmSync(join(releaseDir, file));
}
console.log(`Native modules rebuilt for Electron ${electronVersion}`);
