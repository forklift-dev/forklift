// Merge and rebase from the left panel: merge modes in the dialog, squash with the prepared message in the
// commit form, a conflicting merge started by dragging a branch onto the current one, rebase onto a branch.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRepo, launchApp } from '../harness.mjs';

const item = (name) => `document.querySelector('.ref-item[data-ref=${JSON.stringify(name)}]')`;
const menuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b => b.textContent.startsWith(${JSON.stringify(label)}))`;
const modalButton = (label) => `[...document.querySelectorAll('.modal button')].find(b => b.textContent === ${JSON.stringify(label)})`;

async function contextMenu(page, expression) {
  await page.evaluate(`(() => { const el = ${expression}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 8 })); })()`);
  await page.waitFor(`!!document.querySelector('.context-menu')`);
}

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('f.txt', 'base\n');
  git('add', '.');
  git('commit', '-qm', 'Base');
  for (const name of ['one', 'two', 'three']) {
    git('switch', '-qc', name, 'main');
    write(`${name}.txt`, `${name}\n`);
    git('add', '.');
    git('commit', '-qm', `Work on ${name}`);
  }
  git('switch', '-qc', 'clash', 'main');
  write('f.txt', 'clash version\n');
  git('commit', '-qam', 'Clash');
  git('switch', '-q', 'main');
  write('f.txt', 'main version\n');
  git('commit', '-qam', 'Main moves on');
  const read = (path) => readFileSync(join(root, path), 'utf8');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`!!${item('one')}`);

  // Merge with "always create a merge commit".
  await contextMenu(page, item('one'));
  await page.click(menuItem('Merge one into main'));
  await page.selectOption(`document.querySelector('.form-dialog select[name="mode"]')`, 'no-ff');
  await page.fill(`document.querySelector('.form-dialog input[name="message"]')`, 'Merge one, on purpose');
  // Both fields as the user left them before submitting.
  await page.waitFor(`document.querySelector('.form-dialog input[name="message"]').value === 'Merge one, on purpose' && document.querySelector('.form-dialog select[name="mode"]').value === 'no-ff'`);
  await page.click(`document.querySelector('.form-dialog button[type=submit]')`);
  const merged = await page.waitFor(`[...document.querySelectorAll('.commit-row[data-hash] .subject')].some((s) => s.textContent === 'Merge one, on purpose')`, 15000);
  check('no-ff merge creates a merge commit with the message', merged && git('log', '-1', '--format=%P').split(' ').length === 2, git('log', '-1', '--format=%s'));

  // Squash: staged changes and git's prepared message in the commit form.
  await contextMenu(page, item('two'));
  await page.click(menuItem('Merge two into main'));
  await page.selectOption(`document.querySelector('.form-dialog select[name="mode"]')`, 'squash');
  await page.click(`document.querySelector('.form-dialog button[type=submit]')`);
  const summary = await page.waitFor(`document.querySelector('.commit-summary')?.value`);
  check('squash stages the changes and prefills the message', /^Squashed commit of the following/.test(summary ?? '') && git('diff', '--cached', '--name-only') === 'two.txt', summary);
  await page.click(`document.querySelector('.commit-panel button[type=submit]')`);
  check('…committed as one ordinary commit', await page.waitFor(`/Squashed commit/.test(document.querySelector('.commit-row[data-hash]:has(.ref.head) .subject')?.textContent ?? '')`) && git('log', '-1', '--format=%P').split(' ').length === 1);

  // Drag "clash" onto the current branch: merge with a conflict, resolve, commit.
  await page.evaluate(`(() => {
    const from = ${item('clash')}, to = ${item('main')};
    const dt = new DataTransfer();
    const r = to.getBoundingClientRect();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 40, clientY: r.y + 8 }));
  })()`);
  const options = await page.waitFor(`[...document.querySelectorAll('.context-menu button')].map(b => b.textContent).join(' | ')`);
  check('dropping a branch on the current one offers merge and rebase', /Merge clash into main… \| Rebase main onto clash…/.test(options ?? ''), options);
  await page.click(menuItem('Merge clash into main'));
  await page.click(`document.querySelector('.form-dialog button[type=submit]')`);
  check('conflicting merge shows the banner', /Merging clash/.test((await page.waitFor(`document.querySelector('.operation-banner')?.textContent`)) ?? ''));
  check('…and the prepared merge message', /^Merge branch 'clash'/.test((await page.waitFor(`document.querySelector('.commit-summary')?.value`)) ?? ''));
  await page.click(`[...document.querySelectorAll('.changes .change-item')].find(b => b.textContent.includes('f.txt'))`);
  await page.click(`[...document.querySelectorAll('.conflict-view button')].find(b => b.textContent === 'Use their file')`);
  await page.waitFor(`/all conflicts resolved/.test(document.querySelector('.operation-banner')?.textContent ?? '')`);
  await page.click(`[...document.querySelectorAll('.operation-banner button')].find(b => b.textContent === 'Commit merge')`);
  check('merge completed with their version', await page.waitFor(`!document.querySelector('.operation-banner')`) && read('f.txt') === 'clash version\n');

  // Rebase "three" onto main.
  await page.evaluate(`(${item('three')}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await page.waitFor(`${item('three')}.classList.contains('current')`);
  await contextMenu(page, item('main'));
  await page.click(menuItem('Rebase three onto main'));
  const before = git('rev-parse', 'three');
  await page.click(modalButton('Rebase'));
  // Done when three has moved and the graph shows its new commit (with the HEAD label).
  let rebased = false;
  for (let i = 0; i < 100 && !rebased; i++) {
    rebased = git('rev-parse', 'three') !== before;
    if (!rebased) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const after = git('rev-parse', 'three');
  const shown = await page.waitFor(`document.querySelector('.commit-row[data-hash]:has(.ref.head)')?.dataset.hash === ${JSON.stringify(after)}`);
  check('rebase replays the branch on top', rebased && shown && git('merge-base', '--is-ancestor', 'main', 'three') === '');
}
