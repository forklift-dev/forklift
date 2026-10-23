// Fails unless the packaged app in dist/ has the fuses electron-builder.yml asks for (CI, after `npm run dist`).
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';

const dist = resolve(import.meta.dirname, '..', 'dist');
const candidates = {
  linux: () => readdirSync(dist).filter((d) => /^linux(-[a-z0-9]+)?-unpacked$/.test(d)).map((d) => join(dist, d, 'forklift')),
  darwin: () => readdirSync(dist).filter((d) => /^mac(-[a-z0-9]+)?$/.test(d)).map((d) => join(dist, d, 'Forklift.app')),
  win32: () => readdirSync(dist).filter((d) => /^win(-[a-z0-9]+)?-unpacked$/.test(d)).map((d) => join(dist, d, 'Forklift.exe')),
};
const app = (candidates[process.platform]?.() ?? []).find((path) => existsSync(path));
if (!app) {
  console.error(`No packaged app found in ${dist}`);
  process.exit(1);
}

const expected = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
};
const wire = await getCurrentFuseWire(app);
const wrong = Object.entries(expected).filter(([fuse, on]) => {
  const state = wire[fuse];
  // 0x31 ('1') enabled, 0x30 ('0') disabled; anything else is unknown or removed.
  return state !== (on ? 0x31 : 0x30);
});
for (const [fuse, on] of Object.entries(expected)) console.log(`${FuseV1Options[fuse]}: expected ${on ? 'on' : 'off'}, ${wire[fuse] === 0x31 ? 'on' : wire[fuse] === 0x30 ? 'off' : 'unknown'}`);
if (wrong.length) {
  console.error(`${app}: ${wrong.length} fuse(s) not as configured`);
  process.exit(1);
}
console.log(`${app}: fuses OK`);
