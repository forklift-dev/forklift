// Git starts the isolated diff process beside the regular Forklift window and waits for it to close.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectToPage, createRepo, freePort, launchApp, projectDir } from '../harness.mjs';

export const meta = { platforms: ['linux'] };

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('compare file.txt', 'before\n');
  git('add', '.');
  git('commit', '-qm', 'before');
  write('compare file.txt', 'after\n');

  const main = await launchApp();
  await main.page.invoke('repo:open', root);

  const local = join(root, 'local side.txt');
  const remote = join(root, 'remote side.txt');
  writeFileSync(local, 'before\n');
  writeFileSync(remote, 'after\n');
  const standalone = await launchApp({
    waitForApp: false,
    args: ['difftool', '--local', local, '--remote', remote, '--path', join(root, 'compare file.txt')],
  });
  const standalonePage = standalone.page;
  await standalonePage.waitFor(`!!document.querySelector('.monaco-diff-editor')`, 15000);
  const standaloneText = await standalonePage.evaluate('[...document.querySelectorAll(".view-lines")].map((el) => el.innerText).join("\\n")');
  check('the isolated window displays the two provided versions', standaloneText.includes('before') && standaloneText.includes('after'), standaloneText);
  const standaloneClosed = new Promise((resolve) => standalone.child.once('exit', resolve));
  await standalonePage.press('Escape').catch(() => {}); // closing the window can close CDP before its key-up event
  const standaloneExit = await Promise.race([standaloneClosed, new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
  check('the standalone tool process exits when its window closes', standaloneExit === 0, String(standaloneExit));

  const electron = join(projectDir, 'node_modules/electron/dist/electron');
  const port = await freePort();
  const command = `"${electron}" --remote-debugging-port=${port} "${projectDir}" difftool --local "$LOCAL" --remote "$REMOTE" --path "$MERGED"`;
  git('config', 'diff.tool', 'forklift');
  git('config', 'difftool.forklift.cmd', command);
  const child = spawn('git', ['difftool', '--no-prompt', '--tool=forklift', '--', 'compare file.txt'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let toolLogs = '';
  child.stdout.on('data', (data) => { toolLogs += data; });
  child.stderr.on('data', (data) => { toolLogs += data; });
  let exitCode = null;
  child.once('exit', (code) => { exitCode = code; });
  const toolPage = await connectToPage(port);
  const title = await toolPage.evaluate('document.querySelector(".tool-diff-window header")?.innerText ?? ""');
  const content = await toolPage.evaluate('[...document.querySelectorAll(".view-lines")].map((el) => el.innerText).join("\\n")');
  check('git difftool opens its dedicated diff window', title.includes('compare file.txt'), `${title}; ${toolLogs}`);
  check('Git sides appear in the external diff', content.includes('before') && content.includes('after'), content);
  const closed = new Promise((resolve) => child.once('exit', resolve));
  await toolPage.evaluate('window.close()');
  if (exitCode === null) exitCode = await Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
  check('Git waits for the tool window and exits successfully when it closes', exitCode === 0, String(exitCode));
  check('the ordinary repository window stays open and unchanged', await main.page.evaluate('!!document.querySelector(".app")'));
}
