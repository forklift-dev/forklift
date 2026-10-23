// Remotes from the left panel: add (dialog), fetch, edit URL, rename, remove; auto-fetch settings shown.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createRepo, launchApp, tempDir } from '../harness.mjs';

const menuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b => b.textContent.startsWith(${JSON.stringify(label)}))`;
const remoteGroup = (name) => `document.querySelector('.ref-group-toggle[data-remote=${JSON.stringify(name)}]')`;
const remoteBranches = `[...document.querySelectorAll('[aria-label="Remote"] .ref-item')].map(r => r.dataset.ref).join(',')`;

async function contextMenu(page, expression) {
  await page.evaluate(`(() => { const el = ${expression}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 8 })); })()`);
  await page.waitFor(`!!document.querySelector('.context-menu')`);
}

async function submit(page) {
  await page.waitFor(`!document.querySelector('.form-dialog button[type=submit]').disabled`);
  await page.click(`document.querySelector('.form-dialog button[type=submit]')`);
  await page.waitFor(`!document.querySelector('.form-dialog')`);
}

export default async function ({ check }) {
  const upstream = createRepo({ dir: join(tempDir('forklift-up-'), 'upstream') });
  upstream.write('u.txt', 'up\n');
  upstream.git('add', '.');
  upstream.git('commit', '-qm', 'Upstream work');
  upstream.git('branch', 'release');
  const other = join(tempDir('forklift-other-'), 'other.git');
  execFileSync('git', ['clone', '-q', '--bare', upstream.root, other]);

  const { root, git, write } = createRepo();
  write('a.txt', 'a\n');
  git('add', '.');
  git('commit', '-qm', 'Mine');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);

  await page.click(`document.querySelector('[aria-label="Add remote"]')`);
  await page.fill(`document.querySelector('.form-dialog input[name="name"]')`, 'upstream');
  await page.fill(`document.querySelector('.form-dialog input[name="url"]')`, upstream.root);
  await submit(page);
  check('remote added', await page.waitFor(`!!${remoteGroup('upstream')}`) && git('remote', 'get-url', 'upstream') === upstream.root);

  await contextMenu(page, remoteGroup('upstream'));
  await page.click(menuItem('Fetch upstream'));
  check('fetching it lists its branches', (await page.waitFor(`${remoteBranches} === 'upstream/main,upstream/release' && ${remoteBranches}`)) === 'upstream/main,upstream/release', await page.evaluate(remoteBranches));

  await contextMenu(page, remoteGroup('upstream'));
  await page.click(menuItem('Edit URL'));
  await page.fill(`document.querySelector('.form-dialog input[name="url"]')`, other);
  await page.fill(`document.querySelector('.form-dialog input[name="push"]')`, join(tempDir('forklift-push-'), 'push.git'));
  await submit(page);
  check('fetch and push URLs changed', git('remote', 'get-url', 'upstream') === other && /push\.git$/.test(git('remote', 'get-url', '--push', 'upstream')));

  await contextMenu(page, remoteGroup('upstream'));
  await page.click(menuItem('Rename'));
  await page.fill(`document.querySelector('.form-dialog input[name="name"]')`, 'source');
  await submit(page);
  check('remote renamed with its branches', (await page.waitFor(`${remoteBranches} === 'source/main,source/release' && ${remoteBranches}`)) === 'source/main,source/release');

  await contextMenu(page, remoteGroup('source'));
  await page.click(menuItem('Remove'));
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Remove')`);
  check('remote removed with its branches', await page.waitFor(`!${remoteGroup('source')} && ${remoteBranches} === ''`) && git('remote') === '');

  // Auto-fetch settings in Preferences → General.
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'General')`);
  const general = await page.waitFor(`[...document.querySelectorAll('.setting-row')].map(r => r.dataset.setting).join(',')`);
  check('auto-fetch settings in General', general === 'general.restoreTabs,general.autoFetch,general.autoFetchMinutes,general.fetchPrune,general.notifications,general.repositoriesFolder', general);
}
