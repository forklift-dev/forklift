// Tabs of open repositories: command line, switching (mouse and keys), reordering, closing, the Repositories
// screen, restoring the session after a restart (also with a deleted repository), a second launch, folder scan.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, sleep, tempDir } from '../harness.mjs';

const tabNames = `[...document.querySelectorAll('.tab .tab-name')].map(t => t.textContent).join(',')`;
const activeName = `document.querySelector('.tab.active .tab-name')?.textContent`;
const tabByName = (name) => `[...document.querySelectorAll('.tab')].find(t => t.querySelector('.tab-name').textContent === ${JSON.stringify(name)})`;

export default async function ({ check }) {
  const work = tempDir('forklift-tabs-');
  const repos = {};
  for (const name of ['alpha', 'beta', 'gamma', 'delta']) {
    const repo = createRepo({ dir: join(work, 'projects', name) });
    repo.write('README.md', `# ${name}\n`);
    repo.git('add', '.');
    repo.git('commit', '-qm', `Start ${name}`);
    repos[name] = repo.root;
  }
  const home = tempDir('forklift-home-');

  // Started with a folder inside a repository: that repository opens.
  let app = await launchApp({ home, args: [join(repos.alpha, '.')] });
  let { page } = app;
  check('repository from the command line opens in a tab', (await page.waitFor(activeName)) === 'alpha');
  check('its commits are shown', await page.waitFor(`document.querySelector('.commits .subject')?.textContent.includes('Start alpha')`));

  await page.invoke('repo:open', repos.beta);
  await page.invoke('repo:open', repos.gamma);
  check('tabs open after the active one', (await page.evaluate(tabNames)) === 'alpha,beta,gamma', await page.evaluate(tabNames));

  await page.click(tabByName('alpha'));
  check('clicking a tab shows its repository', await page.waitFor(`document.querySelector('.commits .subject')?.textContent.includes('Start alpha')`));
  await page.press('Tab', { code: 'Tab', keyCode: 9, modifiers: 2 });
  check('Ctrl+Tab → next tab', (await page.waitFor(`${activeName} === 'beta' && ${activeName}`)) === 'beta');
  await page.press('Tab', { code: 'Tab', keyCode: 9, modifiers: 2 | 8 });
  check('Ctrl+Shift+Tab → previous tab', (await page.waitFor(`${activeName} === 'alpha' && ${activeName}`)) === 'alpha');
  await page.press('3', { code: 'Digit3', keyCode: 51, modifiers: 2 });
  check('Ctrl+3 → third tab', (await page.waitFor(`${activeName} === 'gamma' && ${activeName}`)) === 'gamma');
  check('the active tab shows its data', await page.waitFor(`document.querySelector('.commits .subject')?.textContent.includes('Start gamma')`));

  // Drag gamma before alpha (HTML drag and drop events with a DataTransfer, as the browser sends them).
  await page.evaluate(`(() => {
    const from = ${tabByName('gamma')}, to = ${tabByName('alpha')};
    const dt = new DataTransfer();
    const box = to.getBoundingClientRect();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + 2, clientY: box.top + 5 }));
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + 2, clientY: box.top + 5 }));
  })()`);
  check('dragging a tab reorders tabs', (await page.waitFor(`${tabNames} === 'gamma,alpha,beta' && ${tabNames}`)) === 'gamma,alpha,beta', await page.evaluate(tabNames));

  // Ctrl+W closes the active tab; the right neighbour becomes active.
  await page.press('w', { code: 'KeyW', keyCode: 87, modifiers: 2 });
  check('Ctrl+W closes the active tab', (await page.waitFor(`${tabNames} === 'alpha,beta' && ${tabNames}`)) === 'alpha,beta');
  check('the right neighbour becomes active', (await page.evaluate(activeName)) === 'alpha');

  // "+" opens the Repositories screen: recent repositories, favorites.
  await page.click(`document.querySelector('.new-tab')`);
  await page.waitFor(`!!document.querySelector('.repositories')`);
  const recent = await page.evaluate(`[...document.querySelectorAll('[aria-label="Recent"] .repo-row')].map(r => r.querySelector('strong').textContent).join(',')`);
  check('recent repositories, newest first', recent === 'gamma,beta,alpha', recent);
  await page.click(`document.querySelector('[aria-label="Recent"] .repo-row[data-path=${JSON.stringify(repos.gamma)}] .star')`);
  check('star adds to favorites', await page.waitFor(`document.querySelector('[aria-label="Favorites"] .repo-row strong')?.textContent === 'gamma'`));
  await page.click(`document.querySelector('[aria-label="Favorites"] .repo-open')`);
  check('opening from the list adds a tab and leaves the screen', (await page.waitFor(`!document.querySelector('.repositories') && ${activeName} === 'gamma' && ${activeName}`)) === 'gamma');
  check('a closed repository reopens after the active tab', (await page.evaluate(tabNames)) === 'alpha,gamma,beta', await page.evaluate(tabNames));
  await page.click(`document.querySelector('.new-tab')`);
  await page.waitFor(`!!document.querySelector('.repositories')`);
  await page.press('Escape');
  check('Esc goes back from the Repositories screen', await page.waitFor(`!document.querySelector('.repositories') && !!document.querySelector('.commits')`));

  // Searching a folder for repositories.
  const scanned = await page.invoke('repos:scan', join(work, 'projects'));
  check('folder search finds the repositories', JSON.stringify(scanned?.value) === JSON.stringify(['alpha', 'beta', 'delta', 'gamma'].map((n) => repos[n])), JSON.stringify(scanned));

  // A second launch with a folder hands it to the running app and exits.
  const second = await launchApp({ home, page: false, args: [repos.delta] });
  const exited = await Promise.race([new Promise((resolve) => second.child.once('exit', () => resolve(true))), sleep(15000).then(() => false)]);
  check('second launch exits', exited === true);
  check('…and its folder opens in the running app', (await page.waitFor(`${activeName} === 'delta' && ${activeName}`)) === 'delta');

  // Restart: same tabs, same order, same active one. beta is deleted meanwhile.
  await page.click(tabByName('gamma'));
  await page.waitFor(`${activeName} === 'gamma'`);
  const before = await page.evaluate(tabNames);
  await app.close();
  rmSync(repos.beta, { recursive: true, force: true });
  app = await launchApp({ home });
  page = app.page;
  check('tabs restored after restart', (await page.waitFor(`${tabNames} === ${JSON.stringify(before)} && ${tabNames}`)) === before, `${before} → ${await page.evaluate(tabNames)}`);
  check('the active tab restored and read', (await page.waitFor(`${activeName} === 'gamma' && document.querySelector('.commits .subject')?.textContent.includes('Start gamma') && ${activeName}`)) === 'gamma');
  await page.click(tabByName('beta'));
  const missing = await page.waitFor(`document.querySelector('.repo-unavailable p')?.textContent`);
  check('a deleted repository shows an explanation', /No repository at .*beta any more/.test(missing ?? ''), missing);
  check('its tab is marked', await page.evaluate(`${tabByName('beta')}.classList.contains('has-error')`));
  await page.click(`[...document.querySelectorAll('.repo-unavailable button')].find(b => b.textContent === 'Remove tab')`);
  check('Remove tab closes it', (await page.waitFor(`!${tabNames}.includes('beta') && ${tabNames}`)) === before.replace('beta,', '').replace(',beta', ''), await page.evaluate(tabNames));

  // A bad command-line path is reported, not silently ignored.
  await app.close();
  app = await launchApp({ home, args: [join(work, 'not-a-repo')] });
  page = app.page;
  const notice = await page.waitFor(`document.querySelector('.notices')?.textContent`);
  check('bad path from the command line reported', notice?.includes(`Could not open ${join(work, 'not-a-repo')}`), notice);
  check('…while the remembered tabs are still restored', (await page.evaluate(tabNames)).includes('gamma'));
}
