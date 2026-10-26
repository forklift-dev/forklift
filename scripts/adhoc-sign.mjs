// Ad-hoc sign a locally built macOS bundle so arm64 macOS will launch it.
// electron-builder skips signing when there is no Developer ID, and the bundle then keeps
// Electron's stale link-time signature, so the kernel kills the app on launch ("Killed: 9").
// Every Mach-O, helper apps included, needs the same entitlements: an ad-hoc signature has
// no Team ID, and without com.apple.security.cs.disable-library-validation the helpers
// cannot load Electron Framework ("different Team IDs").
//
//   node scripts/adhoc-sign.mjs dist/mac-arm64/Forklift.app
import { resolve } from 'node:path';
import { signAsync } from '@electron/osx-sign';

const repoRoot = resolve(import.meta.dirname, '..');
const app = process.argv[2];
if (!app) {
  console.error('usage: node scripts/adhoc-sign.mjs <path/to/Forklift.app>');
  process.exit(2);
}

await signAsync({
  app: resolve(app),
  identity: '-',
  identityValidation: false, // "-" is ad-hoc: there is no keychain identity to look up
  hardenedRuntime: true,
  type: 'distribution',
  optionsForFile: () => ({
    entitlements: resolve(repoRoot, 'node_modules/app-builder-lib/templates/entitlements.mac.plist'),
  }),
});
console.log(`ad-hoc signed: ${app}`);
