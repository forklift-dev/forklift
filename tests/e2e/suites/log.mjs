// Notifications and the operation log: a toast for a finished operation, an error banner whose Details open
// the log at the failed operation with git's output, filtering, notifications turned off, and a progress
// toast (with Cancel) while a push waits for credentials.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { startGitHttpServer } from '../gitHttp.mjs';
import { createRepo, defer, launchApp, tempDir } from '../harness.mjs';

const toolbarButton = (label) => `[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const toast = `document.querySelector('.toast.success')?.textContent`;

export default async function ({ check }) {
  const { root, git, write } = createRepo({ dir: join(tempDir('forklift-log-'), 'repo') });
  write('a.txt', 'one\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  write('a.txt', 'two\n');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.change-row')`);

  // A finished operation shows a toast; its Log button opens the log at it.
  await page.click(toolbarButton('Stash'));
  const stashed = await page.waitFor(`${toast}`, 5000);
  check('a toast says the operation finished', /Changes stashed · repo/.test(stashed ?? ''), stashed);
  await page.click(`[...document.querySelectorAll('.toast.success button')].find(b => b.textContent === 'Log')`);
  check('the toast opens the log', await page.waitFor(`!!document.querySelector('.log-view')`));
  const entry = `[...document.querySelectorAll('.log-entry.operation')].find(e => e.querySelector('.log-title').textContent === 'stash:push')`;
  check('the operation is in the log, opened, with its git commands', await page.waitFor(`${entry}?.querySelector('.log-row').getAttribute('aria-expanded') === 'true' && [...document.querySelectorAll('.log-entry.git.nested .log-title')].some(t => t.textContent.startsWith('git stash push'))`));
  await page.press('Escape');
  await page.waitFor(`!document.querySelector('.log-view')`);

  // An error explains itself: Details opens the failing git command and its output.
  await page.click(toolbarButton('Pull'));
  const banner = await page.waitFor(`document.querySelector('.error-banner:not(.notices)')?.textContent`, 10000);
  check('a failed operation shows an error with Details', /Details$/.test(banner ?? ''), banner);
  await page.click(`document.querySelector('.error-banner .error-details')`);
  await page.waitFor(`!!document.querySelector('.log-view')`);
  const failed = `[...document.querySelectorAll('.log-entry.operation.error')].find(e => e.querySelector('.log-title').textContent === 'remote:pull')`;
  check('Details opens the failed operation', await page.waitFor(`${failed}?.querySelector('.log-row').getAttribute('aria-expanded') === 'true'`));
  const output = await page.waitFor(`${failed}.querySelector('.log-details')?.textContent`);
  check('with the error message', /Error/.test(output ?? ''), output);
  check('and the failing git command with its output', await page.waitFor(`[...document.querySelectorAll('.log-entry.git.error.nested')].some(e => e.querySelector('.log-title').textContent.startsWith('git pull'))`));

  // Filtering.
  await page.click(`[...document.querySelectorAll('.log-header label')].find(l => l.textContent.includes('Errors only')).querySelector('input')`);
  check('"Errors only" hides what worked', await page.waitFor(`![...document.querySelectorAll('.log-entry.operation .log-title')].some(t => t.textContent === 'stash:push') && !!${failed}`));
  await page.click(`[...document.querySelectorAll('.log-header label')].find(l => l.textContent.includes('Errors only')).querySelector('input')`);
  await page.fill(`document.querySelector('.log-header input[type="search"]')`, 'stash:push');
  check('the filter narrows the log', await page.waitFor(`[...document.querySelectorAll('.log-group > ul > .log-entry .log-title')].map(t => t.textContent).join() === 'stash:push'`));
  await page.click(`[...document.querySelectorAll('.log-header button')].find(b => b.textContent === 'Clear')`);
  check('Clear empties the log', await page.waitFor(`/Nothing logged yet|Nothing matches/.test(document.querySelector('.log-list').textContent) && !document.querySelector('.log-entry')`));
  await page.press('Escape');

  // Notifications can be turned off.
  await page.invoke('settings:update', { values: { 'general.notifications': false } });
  await page.waitFor(`!document.querySelector('.toast.success')`, 6000);
  await page.click(toolbarButton('Pop'));
  await page.waitFor(`!document.querySelector('.commit-row.stash') && !document.querySelector('.toolbar .spinner')`, 5000);
  check('no toast when notifications are off', await page.evaluate(`new Promise(r => setTimeout(() => r(!document.querySelector('.toast.success')), 600))`));
  await page.invoke('settings:update', { values: { 'general.notifications': true } });

  // A long operation shows its progress, and can be cancelled from the toast.
  const served = tempDir('forklift-served-');
  execFileSync('git', ['init', '-q', '--bare', join(served, 'origin.git')]);
  execFileSync('git', ['config', 'http.receivepack', 'true'], { cwd: join(served, 'origin.git') });
  const http = await startGitHttpServer(served, { user: 'ada', password: 'lovelace' });
  defer(() => http.close());
  git('remote', 'add', 'origin', `${http.url}/origin.git`);
  await page.invoke('repo:refresh', root);
  await page.click(toolbarButton('Push'));
  // No upstream yet: the app asks which remote.
  const pushTo = `[...document.querySelectorAll('.modal button')].find(b => b.textContent.trim() === 'Push')`;
  await page.waitFor(`!!${pushTo}`, 3000);
  await page.click(pushTo);
  check('a running push shows a progress toast', await page.waitFor(`/Pushing repo/.test(document.querySelector('.toast.progress')?.textContent ?? '')`, 10000));
  await page.waitFor(`!!document.querySelector('.prompt-dialog')`, 10000);
  await page.evaluate(`[...document.querySelectorAll('.toast.progress button')].find(b => b.textContent === 'Cancel').click()`);
  check('Cancel in the toast stops it', await page.waitFor(`!document.querySelector('.toast.progress') && !document.querySelector('.prompt-dialog')`, 10000));
}
