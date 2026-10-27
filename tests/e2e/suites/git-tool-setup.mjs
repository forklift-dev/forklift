// The setup CLI runs in its own process while the main UI is already open; dry-run leaves config untouched.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createRepo, launchApp, projectDir } from '../harness.mjs';

export default async function ({ check }) {
  const { root } = createRepo();
  const { page } = await launchApp();
  await page.invoke('repo:open', root);

  const electron = join(projectDir, 'node_modules/electron/dist/electron');
  const result = spawnSync(electron, [projectDir, 'setup', '--local', '--dry-run'], { cwd: root, encoding: 'utf8', timeout: 20_000 });
  check('setup command runs while the main app is open', result.status === 0, result.stderr || result.error?.message);
  check('dry-run prints the local tool plan', result.stdout.includes('Dry run') && result.stdout.includes('difftool.forklift.cmd') && result.stdout.includes('mergetool.forklift.cmd'), result.stdout);
  const config = spawnSync('git', ['config', '--local', '--get', 'diff.tool'], { cwd: root, encoding: 'utf8' });
  check('dry-run leaves repository config unchanged', config.status !== 0);
}
