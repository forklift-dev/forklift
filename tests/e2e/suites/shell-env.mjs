// A desktop-menu launch (no TTY, minimal PATH) picks up PATH and variables from the login shell's rc files.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inMain, launchApp, tempDir } from '../harness.mjs';

export const meta = { requiresMain: true, platforms: ['linux', 'darwin'] };
const ZSH = ['/usr/bin/zsh', '/bin/zsh'].find((path) => existsSync(path));

async function launch(mode) {
  const home = tempDir('forklift-home-rc-');
  mkdirSync(join(home, 'rcbin'));
  writeFileSync(join(home, 'rcbin', 'forklift-probe'), '#!/bin/sh\necho probe-found\n', { mode: 0o755 });
  writeFileSync(join(home, '.zshrc'), 'echo "zshrc noise"\nexport PATH="$HOME/rcbin:$PATH"\nexport FROM_RC=yes\n');
  const app = await launchApp({
    baseEnv: 'minimal',
    inspect: true,
    page: false,
    // What a desktop session typically hands a GUI app; stdio is piped, so the app sees no TTY.
    env: { HOME: home, SHELL: ZSH, PATH: '/usr/bin:/bin', FORKLIFT_SHELL_ENV: mode },
  });
  const r = (code) => inMain(app, code);
  const probe = await r(`try { const res = await runner.run('forklift-probe', []); return res.stdout.trim(); } catch (e) { return e.name + ':' + e.code; }`);
  const fromRc = await r(`const res = await runner.run('sh', ['-c', 'printf %s "$FROM_RC"']); return res.stdout`);
  const gitVersion = await app.main.waitFor(`globalThis.forkliftDebug.store.getState().app.gitCli?.version`);
  await app.close();
  return { probe, fromRc, gitVersion, logs: app.logs };
}

export default async function ({ check }) {
  if (!check('zsh installed (needed by this suite)', Boolean(ZSH))) return;
  const gui = await launch(undefined);
  check('GUI launch: tool from .zshrc PATH is found', gui.probe === 'probe-found', gui.probe);
  check('GUI launch: variable exported in .zshrc is visible', gui.fromRc === 'yes', JSON.stringify(gui.fromRc));
  check('GUI launch: git detected after env resolution', /^\d+\.\d+\.\d+$/.test(gui.gitVersion ?? ''), gui.gitVersion);
  const logLine = gui.logs.split('\n').find((line) => line.includes('shell env:'));
  check('resolution logged', Boolean(logLine?.includes(`resolved from ${ZSH}`)), logLine?.trim());

  const off = await launch('off');
  check('FORKLIFT_SHELL_ENV=off: rc PATH not applied', off.probe === 'ProcessError:ENOENT', off.probe);
}
