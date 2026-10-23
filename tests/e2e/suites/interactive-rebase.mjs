// Interactive rebase from the graph: actions per commit, reordering, messages for reword and squash.
import { createRepo, launchApp } from '../harness.mjs';

const row = (subject) => `[...document.querySelectorAll('.rebase-row')].find(r => r.querySelector('.rebase-subject').textContent === ${JSON.stringify(subject)})`;

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('base.txt', 'base\n');
  git('add', '.');
  git('commit', '-qm', 'Base');
  for (const name of ['one', 'two', 'three', 'four', 'five']) {
    write(`${name}.txt`, `${name}\n`);
    git('add', '.');
    git('commit', '-qm', `Add ${name}`);
  }

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  const base = `[...document.querySelectorAll('.commit-row[data-hash]')].find(r => r.querySelector('.subject').textContent === 'Base')`;
  await page.waitFor(`!!${base}`);
  await page.evaluate(`(() => { const el = ${base}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 300, clientY: r.y + 8 })); })()`);
  await page.click(`[...document.querySelectorAll('.context-menu button')].find(b => b.textContent.startsWith('Interactive rebase'))`);
  const listed = await page.waitFor(`[...document.querySelectorAll('.rebase-subject')].map(s => s.textContent).join(',')`);
  check('plan lists the commits after the base, newest first', listed === 'Add five,Add four,Add three,Add two,Add one', listed);

  await page.selectOption(`${row('Add five')}.querySelector('select')`, 'drop');
  await page.selectOption(`${row('Add three')}.querySelector('select')`, 'squash');
  const combined = await page.waitFor(`${row('Add two')}.querySelector('textarea')?.value`);
  check('squash shows the combined message on the commit below', combined === 'Add two\n\nAdd three', JSON.stringify(combined));
  await page.fill(`${row('Add two')}.querySelector('textarea')`, 'Two and three together');
  await page.selectOption(`${row('Add one')}.querySelector('select')`, 'reword');
  await page.fill(`${row('Add one')}.querySelector('textarea')`, 'One, said better');
  // Move "four" to the bottom (it becomes the oldest).
  for (let i = 0; i < 3; i++) await page.click(`${row('Add four')}.querySelector('[aria-label="Move down (earlier)"]')`);
  check('rows reordered', (await page.evaluate(`[...document.querySelectorAll('.rebase-subject')].map(s => s.textContent).join(',')`)) === 'Add five,Add three,Add two,Add one,Add four');

  await page.click(`[...document.querySelectorAll('.rebase-view button')].find(b => b.textContent === 'Start rebase')`);
  await page.waitFor(`!document.querySelector('.rebase-view')`, 15000);
  const log = git('log', '--format=%s', 'HEAD~3..HEAD').split('\n');
  check('rebased: four first, one reworded, two+three squashed, five dropped', JSON.stringify(log) === JSON.stringify(['Two and three together', 'One, said better', 'Add four']), JSON.stringify(log));
  check('the squashed commit holds both changes', git('show', '--name-only', '--format=', 'HEAD').split('\n').sort().join() === 'three.txt,two.txt');
  check('the graph shows the new history', await page.waitFor(`[...document.querySelectorAll('.commit-row[data-hash] .subject')].some((s) => s.textContent === 'Two and three together')`));
}
