// Stash through the UI: toolbar Stash/Pop, the stash dialog (message, only staged), stashes in the graph and the
// left panel, details with untracked files, apply/pop/delete, a conflicting pop that keeps the stash.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp } from '../harness.mjs';

const toolbarButton = (label) => `[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const changes = `[...document.querySelectorAll('.changes .change-item')].map(b => b.textContent.trim()).join(',')`;
const stashItems = `[...document.querySelectorAll('.ref-item[data-stash]')].map(r => r.title).join(' | ')`;
const menuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === ${JSON.stringify(label)})`;

async function contextMenu(page, expression) {
  await page.evaluate(`(() => { const el = ${expression}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 8 })); })()`);
  await page.waitFor(`!!document.querySelector('.context-menu')`);
}

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('a.txt', 'one\n');
  write('b.txt', 'bee\n');
  git('add', '.');
  git('commit', '-qm', 'Base');
  write('a.txt', 'two\n');
  write('notes.md', 'untracked notes\n');
  const read = (path) => readFileSync(join(root, path), 'utf8');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`${changes}.includes('notes.md')`);

  await page.click(toolbarButton('Stash'));
  check('toolbar Stash takes all changes, untracked included', await page.waitFor(`${changes} === ''`) && read('a.txt') === 'one\n' && !existsSync(join(root, 'notes.md')));
  check('stash listed in the left panel', /WIP on main/.test(await page.waitFor(stashItems)));
  const stashRow = `document.querySelector('.commit-row.stash')`;
  check('stash drawn in the graph above its base', await page.waitFor(`!!${stashRow} && ${stashRow}.nextElementSibling?.textContent.includes('Base')`));

  await page.click(stashRow);
  const files = await page.waitFor(`[...document.querySelectorAll('.commit-details .change-item')].map(b => b.textContent).join(',')`);
  check('stash details include the untracked file', /a\.txt/.test(files) && /notes\.mduntracked/.test(files), files);
  await page.click(`[...document.querySelectorAll('.commit-details .change-item')].find(b => b.textContent.startsWith('Anotes.md'))`);
  check('untracked file of the stash opens in the diff', await page.waitFor(`document.querySelector('.monaco-diff-editor .editor.modified .view-lines')?.textContent.replace(/\\u00a0/g, ' ').includes('untracked notes')`));
  await page.press('Escape');

  // Apply from the details: changes back, stash kept.
  await page.click(`[...document.querySelectorAll('.commit-details-actions button')].find(b => b.textContent === 'Apply')`);
  check('Apply brings the changes back and keeps the stash', (await page.waitFor(`${changes}.includes('notes.md') && ${changes}`)) && git('stash', 'list').split('\n').length === 1);

  // The dialog: only staged changes, with a message.
  git('checkout', '-q', '--', '.');
  git('clean', '-qfd');
  write('a.txt', 'staged change\n');
  git('add', 'a.txt');
  write('b.txt', 'unstaged change\n');
  await page.waitFor(`${changes}.includes('b.txt')`);
  await page.click(`document.querySelector('[aria-label="Stash changes"]')`);
  await page.fill(`document.querySelector('.form-dialog input[name="message"]')`, 'staged work');
  await page.click(`document.querySelector('.form-dialog input[name="untracked"]')`);
  await page.click(`document.querySelector('.form-dialog input[name="staged"]')`);
  await page.waitFor(`!document.querySelector('.form-dialog button[type=submit]').disabled`);
  await page.click(`document.querySelector('.form-dialog button[type=submit]')`);
  check('dialog stash with a message, only staged changes', /staged work/.test(await page.waitFor(`${stashItems}.includes('staged work') && ${stashItems}`)) && read('a.txt') === 'one\n' && read('b.txt') === 'unstaged change\n');

  // Delete the older stash from the panel.
  await contextMenu(page, `[...document.querySelectorAll('.ref-item[data-stash]')].find(r => r.title.includes('WIP on'))`);
  await page.click(menuItem('Delete stash…'));
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Delete')`);
  check('stash deleted after confirmation', await page.waitFor(`!${stashItems}.includes('WIP on')`) && git('stash', 'list').split('\n').length === 1);

  // Pop from the toolbar: applied and gone.
  git('checkout', '-q', '--', '.');
  await page.waitFor(`${changes} === ''`);
  await page.click(toolbarButton('Pop'));
  check('toolbar Pop applies and removes the stash', await page.waitFor(`${stashItems} === ''`) && read('a.txt') === 'staged change\n' && git('diff', '--cached', '--name-only') === 'a.txt');

  // A pop that conflicts keeps the stash and says so.
  await page.click(toolbarButton('Stash'));
  await page.waitFor(`${changes} === ''`);
  write('a.txt', 'committed meanwhile\n');
  git('commit', '-qam', 'Meanwhile');
  await page.waitFor(`document.querySelector('.commit-row[data-hash] .subject')?.textContent === 'Meanwhile'`, 5000);
  await page.click(toolbarButton('Pop'));
  const notice = await page.waitFor(`document.querySelector('.notices')?.textContent`);
  check('conflicting pop reported, stash kept', /with conflicts in a\.txt.*The stash is kept/.test(notice ?? '') && git('stash', 'list').split('\n').length === 1, notice);
}
