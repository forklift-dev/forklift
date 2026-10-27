// Git waits for the external merge editor; Cancel leaves MERGED untouched and Save resolves it.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectToPage, createRepo, freePort, launchApp, projectDir } from '../harness.mjs';

export const meta = { platforms: ['linux'] };

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('conflict file.txt', 'start\nbase version\nend\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'incoming');
  write('conflict file.txt', 'start\nremote version\nend\n');
  git('commit', '-qam', 'incoming change');
  git('checkout', '-q', 'main');
  write('conflict file.txt', 'start\nlocal version\nend\n');
  git('commit', '-qam', 'local change');
  git.allowFail('merge', 'incoming');
  const original = readFileSync(join(root, 'conflict file.txt'), 'utf8');

  const main = await launchApp();
  await main.page.invoke('repo:open', root);
  const electron = join(projectDir, 'node_modules/electron/dist/electron');
  const runTool = async () => {
    const port = await freePort();
    const command = `"${electron}" --remote-debugging-port=${port} "${projectDir}" mergetool --base "$BASE" --local "$LOCAL" --remote "$REMOTE" --merged "$MERGED"`;
    git('config', 'merge.tool', 'forklift');
    git('config', 'mergetool.forklift.cmd', command);
    git('config', 'mergetool.forklift.trustExitCode', 'true');
    git('config', 'mergetool.keepBackup', 'false');
    const child = spawn('git', ['mergetool', '--no-prompt', '--tool=forklift', '--', 'conflict file.txt'], { cwd: root, stdio: 'ignore' });
    const page = await connectToPage(port);
    return { child, page };
  };

  const cancel = await runTool();
  await cancel.page.waitFor(`!!document.querySelector('.tool-merge-result .monaco-editor .view-lines')`, 15000);
  const inputs = await cancel.page.evaluate(`(() => {
    const normalize = (side) => document.querySelector('[data-side="' + side + '"]')?.innerText.replace(/\\u00a0/g, ' ');
    return { base: normalize('base'), local: normalize('local'), remote: normalize('remote') };
  })()`);
  check('the window shows BASE, LOCAL and REMOTE versions', /base version/.test(inputs.base) && /local version/.test(inputs.local) && /remote version/.test(inputs.remote), JSON.stringify(inputs));
  const cancelExit = new Promise((resolve) => cancel.child.once('exit', resolve));
  await cancel.page.press('Escape').catch(() => {});
  const cancelled = await Promise.race([cancelExit, new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
  check('Cancel returns a nonzero code to Git', typeof cancelled === 'number' && cancelled !== 0, String(cancelled));
  check('Cancel does not write the MERGED file', readFileSync(join(root, 'conflict file.txt'), 'utf8') === original);

  const save = await runTool();
  await save.page.waitFor(`!!document.querySelector('.tool-merge-result .monaco-editor .view-lines')`, 15000);
  const point = await save.page.evaluate(`(() => { const el = document.querySelector('.tool-merge-result .monaco-editor .view-lines'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + 40, y: r.top + 10 }; })()`);
  if (!point) throw new Error('result editor did not render');
  await save.page.clickAt(point.x, point.y);
  await save.page.press('A', { code: 'KeyA', keyCode: 65, modifiers: 2 });
  await save.page.insertText('resolved by Forklift\n');
  await save.page.click(` [...document.querySelectorAll('.tool-merge-window button')].find(button => button.textContent.trim() === 'Save and close')`);
  const saved = await new Promise((resolve) => save.child.once('exit', resolve));
  check('Save returns success to Git', saved === 0, String(saved));
  check('Save writes only the requested MERGED result', readFileSync(join(root, 'conflict file.txt'), 'utf8') === 'resolved by Forklift\n');
  check('Git records the file as resolved', git('diff', '--name-only', '--diff-filter=U') === '');
  const cleanRun = spawnSync('git', ['mergetool', '--no-prompt', '--tool=forklift'], { cwd: root, encoding: 'utf8' });
  check('a non-conflicting mergetool run exits cleanly', cleanRun.status === 0, cleanRun.stderr || cleanRun.stdout);
  check('the regular repository window stays open', await main.page.evaluate('!!document.querySelector(".app")'));
}
