// Bottom status bar: repository/system facts, graph chooser, actions, visibility command and About dialog.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, inMain, launchApp, processesMatching, projectDir, sleep, tempDir } from '../harness.mjs';

export const meta = { requiresMain: true, platforms: ['linux', 'darwin'] };

export default async function ({ check }) {
  const { root, git, write } = createRepo({ dir: join(tempDir('forklift-status-'), 'repo') });
  write('a.txt', 'one\n');
  git('add', '.');
  git('commit', '-qm', 'one');
  write('a.txt', 'two\n');
  git('add', '.');
  git('commit', '-qm', 'two');
  write('a.txt', 'changed\n');
  writeFileSync(join(root, '.git', 'FETCH_HEAD'), `${git('rev-parse', 'HEAD')}\t\tbranch 'main' of local\n`);

  const app = await launchApp({ inspect: true, windowSize: '900,700' });
  const { page } = app;
  const main = (code) => inMain(app, code);
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.commit-row[data-hash]')`);

  const text = await page.waitFor(`document.querySelector('.status-bar')?.textContent.includes('History: 2') && document.querySelector('.status-bar').textContent`);
  const appVersion = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).version;
  check('shows branch, changes, fetch time, git, history, memory and edition', /main/.test(text ?? '') && /Changes: 1/.test(text ?? '') && /Fetch:/.test(text ?? '') && /git \d+\.\d+/.test(text ?? '') && /History: 2/.test(text ?? '') && /(?:MB|GB)/.test(text ?? '') && (text ?? '').replace(/\s/g, '').includes(`Communityv${appVersion}`), text);
  check('fits a 900 px window without horizontal overflow', await page.evaluate(`document.querySelector('.status-bar').scrollWidth <= innerWidth`));

  // Compact graph chooser with real previews changes the live graph.
  await page.click(`document.querySelector('.status-bar [aria-label="Choose graph style"]')`);
  check('graph menu has a preview and radio for every style', (await page.evaluate(`document.querySelectorAll('.status-graph-option[role="radio"] .graph-style-preview').length`)) === 7);
  await page.click(`document.querySelector('[data-status-graph-style="metro"]')`);
  check('graph choice applies immediately', await page.waitFor(`document.querySelector('.commits')?.classList.contains('graph-style-metro')`));

  await page.click(`document.querySelector('.status-item[title="Switch branch"]')`);
  check('branch item opens the switcher', await page.waitFor(`document.querySelector('.palette-input')?.placeholder === 'Switch to branch'`));
  await page.press('Escape');
  await page.click(`document.querySelector('.status-item[title="Write the commit message"]')`);
  check('changes item focuses the commit form', await page.waitFor(`document.activeElement?.classList.contains('commit-summary')`));

  // Missing commit-graph is actionable and the refreshed repository reports it.
  await page.click(`document.querySelector('.status-item[title="Build commit graph"]')`);
  check('history item writes a commit-graph', await page.waitFor(`!!document.querySelector('.status-item[title="Rebuild commit graph"]')`, 5000) && existsSync(join(root, '.git', 'objects', 'info', 'commit-graph')));

  // A genuine long-running git command appears in system information and can be stopped there.
  await main(`runner.run('git', ['-c', 'alias.wait=!sleep 30', 'wait'], { cwd: ${JSON.stringify(root)} }).catch(() => {}); return true;`);
  await page.waitFor(`document.querySelector('.status-count')?.textContent === '1'`, 6000);
  await page.click(`document.querySelector('.status-menu-anchor.system > button')`);
  const running = await page.waitFor(`document.querySelector('.status-system-menu code')?.textContent`);
  check('system menu lists running git and application facts', /git .*wait/.test(running ?? '') && await page.evaluate(`document.querySelector('.status-system-menu').textContent.includes('Application memory') && document.querySelector('.status-system-menu').textContent.includes('Forklift version')`), running);
  await page.click(`document.querySelector('.status-system-menu .danger')`);
  await sleep(400);
  check('running git process can be cancelled', processesMatching('sleep 30').length === 0 && await page.waitFor(`!document.querySelector('.status-system-menu li')`));

  await page.click(`document.querySelector('.status-community')`);
  const about = await page.waitFor(`document.querySelector('.about-dialog')?.textContent`);
  check('About has authors, promise and attributed quote', /@akryll/.test(about ?? '') && /Claude \(Anthropic\)/.test(about ?? '') && /always be open and free, with no paid features/.test(about ?? '') && /attributed to Marcus Tullius/.test(about ?? ''));
  check('About shows the application logo', await page.waitFor(`document.querySelector('.about-logo')?.complete && document.querySelector('.about-logo').naturalWidth > 0`));
  check('owner name links to Telegram', await page.evaluate(`document.querySelector('.about-dialog a')?.href === 'https://t.me/akryll'`));
  await page.press('Escape');
  await page.waitFor(`!document.querySelector('.about-dialog')`);

  // The palette command persists through the same setting used by Preferences.
  await page.press('P', { code: 'KeyP', keyCode: 80, modifiers: 10 });
  await page.insertText('status bar');
  await page.waitFor(`document.querySelector('.palette-item.active')?.textContent.includes('Show or hide the status bar')`);
  await page.press('Enter');
  check('palette command hides the bar', await page.waitFor(`!document.querySelector('.status-bar')`));
  await page.press('P', { code: 'KeyP', keyCode: 80, modifiers: 10 });
  await page.insertText('status bar');
  await page.waitFor(`document.querySelector('.palette-item.active')?.textContent.includes('Show or hide the status bar')`);
  await page.press('Enter');
  check('palette command shows the bar again', await page.waitFor(`!!document.querySelector('.status-bar')`));
}
