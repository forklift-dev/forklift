// The setup CLI runs in its own process while the main UI is already open; dry-run leaves config untouched.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createRepo, launchApp, projectDir } from '../harness.mjs';

export default async function ({ check }) {
  const { root } = createRepo();
  const { page } = await launchApp();
  await page.invoke('repo:open', root);

  const electron = join(projectDir, 'node_modules/electron/dist/electron');
  const run = (...args) => spawnSync('git', ['config', '--local', ...args], { cwd: root, encoding: 'utf8' });
  const invoke = (...args) => spawnSync(electron, [projectDir, ...args], { cwd: root, encoding: 'utf8', timeout: 20_000 });
  run('--add', 'diff.tool', 'meld');
  run('--add', 'mergetool.forklift.cmd', 'old merge command');
  const dryRun = invoke('setup', '--local', '--dry-run');
  check('setup command runs while the main app is open', dryRun.status === 0, dryRun.stderr || dryRun.error?.message);
  check('dry-run prints the local tool plan', dryRun.stdout.includes('Dry run') && dryRun.stdout.includes('difftool.forklift.cmd') && dryRun.stdout.includes('mergetool.forklift.cmd'), dryRun.stdout);
  check('dry-run leaves repository config unchanged', run('--get-all', 'diff.tool').stdout.trim() === 'meld');

  const install = invoke('setup', '--local');
  check('setup registers Forklift as the local tool', install.status === 0 && run('--get', 'diff.tool').stdout.trim() === 'forklift', install.stderr || install.stdout);
  check('tool command preserves Git variables and quotes app paths', run('--get', 'difftool.forklift.cmd').stdout.includes('"$LOCAL"') && run('--get', 'difftool.forklift.cmd').stdout.includes('"$REMOTE"'));
  check('repeated setup is refused without changing its command', invoke('setup', '--local').status !== 0 && run('--get', 'difftool.forklift.cmd').stdout.includes(projectDir));

  const remove = invoke('uninstall', '--local');
  check('uninstall restores the previous user values', remove.status === 0 && run('--get-all', 'diff.tool').stdout.trim() === 'meld' && run('--get', 'mergetool.forklift.cmd').stdout.trim() === 'old merge command', remove.stderr || remove.stdout);
  check('uninstall removes only newly added tool settings', run('--get', 'difftool.forklift.cmd').status !== 0 && run('--get', 'mergetool.forklift.trustExitCode').status !== 0);
}
