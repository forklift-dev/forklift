// Commit operations from the graph's context menu: cherry-pick (clean and with conflicts → banner → abort),
// revert, reset soft/hard with confirmation, checkout of a commit (detached HEAD warning).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp } from '../harness.mjs';

const row = (subject) => `[...document.querySelectorAll('.commit-row[data-hash]')].find(r => r.querySelector('.subject').textContent === ${JSON.stringify(subject)})`;
const menuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b => b.textContent.startsWith(${JSON.stringify(label)}))`;
const modalButton = (label) => `[...document.querySelectorAll('.modal button')].find(b => b.textContent === ${JSON.stringify(label)})`;
const top = `document.querySelector('.commit-row[data-hash] .subject')?.textContent`;

async function menu(page, subject, label) {
  await page.waitFor(`!!${row(subject)}`);
  await page.evaluate(`(() => { const el = ${row(subject)}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 300, clientY: r.y + 8 })); })()`);
  await page.waitFor(`!!${menuItem(label)}`);
  await page.click(menuItem(label));
}

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('f.txt', 'base\n');
  git('add', '.');
  git('commit', '-qm', 'Base');
  git('switch', '-qc', 'feature');
  write('g.txt', 'from feature\n');
  git('add', '.');
  git('commit', '-qm', 'Add g');
  write('f.txt', 'feature edit\n');
  git('commit', '-qam', 'Edit f on feature');
  git('switch', '-q', 'main');
  write('f.txt', 'main edit\n');
  git('commit', '-qam', 'Edit f on main');
  const read = (path) => readFileSync(join(root, path), 'utf8');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);

  await menu(page, 'Add g', 'Cherry-pick commit');
  check('cherry-pick adds the commit on top', (await page.waitFor(`${top} === 'Add g' && ${top}`)) === 'Add g' && read('g.txt') === 'from feature\n');

  await menu(page, 'Edit f on feature', 'Cherry-pick commit');
  check('conflicting cherry-pick shows the banner', /Cherry-picking.*1 conflicted file/.test((await page.waitFor(`document.querySelector('.operation-banner')?.textContent`)) ?? ''));
  await page.click(`[...document.querySelectorAll('.operation-banner button')].find(b => b.textContent === 'Abort')`);
  await page.click(modalButton('Abort'));
  check('…and can be aborted', await page.waitFor(`!document.querySelector('.operation-banner')`) && read('f.txt') === 'main edit\n');

  await menu(page, 'Add g', 'Revert commit');
  check('revert asks first', /Revert “Add g”/.test((await page.waitFor(`document.querySelector('.modal h2')?.textContent`)) ?? ''));
  await page.click(modalButton('Revert'));
  check('revert commits the inverse', (await page.waitFor(`${top} === 'Revert "Add g"' && ${top}`)) === 'Revert "Add g"');

  // Undo the revert, keeping its change (the removal of g.txt) staged.
  await menu(page, 'Add g', 'Reset main to here: soft');
  await page.click(modalButton('Reset soft'));
  check('soft reset keeps the changes staged', (await page.waitFor(`${top} === 'Add g'`)) && git('diff', '--cached', '--name-status') === 'D\tg.txt', git('diff', '--cached', '--name-status'));

  write('f.txt', 'uncommitted\n');
  await menu(page, 'Base', 'Reset main to here: hard');
  const warning = await page.waitFor(`document.querySelector('.modal p')?.textContent`);
  check('hard reset warns about losing changes', /ALL uncommitted changes are discarded/.test(warning ?? ''), warning);
  await page.click(modalButton('Reset hard'));
  // feature's commits are newer than Base, so main is no longer the top row: check where main points.
  const headLabel = `${row('Base')}?.querySelector('.ref.head')?.textContent`;
  check('hard reset discards everything after the commit', (await page.waitFor(`${headLabel} === 'main'`)) && read('f.txt') === 'base\n' && git('status', '--porcelain') === '', git('status', '--porcelain'));

  await menu(page, 'Edit f on feature', 'Check out this commit');
  check('detached checkout warns first', /detached HEAD/.test((await page.waitFor(`document.querySelector('.modal p')?.textContent`)) ?? ''));
  await page.click(modalButton('Check out'));
  check('…then checks out the commit', await page.waitFor(`/detached at/.test(document.querySelector('.toolbar .branch')?.textContent ?? '')`) && read('f.txt') === 'feature edit\n');
}
