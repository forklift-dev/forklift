// Branches and tags through the UI: left panel, double-click checkout with automatic stash (clean, carried
// over, conflict), create/rename/delete with dialogs, tags from the graph's context menu, remote branches.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp } from '../harness.mjs';

const item = (name) => `document.querySelector('.ref-item[data-ref=${JSON.stringify(name)}]')`;
const menuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === ${JSON.stringify(label)})`;
const currentBranch = `document.querySelector('.toolbar .branch')?.firstChild?.textContent`;

async function contextMenu(page, expression) {
  await page.evaluate(`(() => { const el = ${expression}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 8 })); })()`);
  await page.waitFor(`!!document.querySelector('.context-menu')`);
}

async function doubleClick(page, expression) {
  await page.evaluate(`(${expression}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
}

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('shared.txt', 'line 1\nline 2\nline 3\n');
  write('other.txt', 'other\n');
  git('add', '.');
  git('commit', '-qm', 'Base');
  git('switch', '-qc', 'feature');
  write('shared.txt', 'line 1\nline 2 on feature\nline 3\n');
  git('commit', '-qam', 'Feature change');
  git('switch', '-q', 'main');
  git('update-ref', 'refs/remotes/origin/review', git('rev-parse', 'feature'));
  git('config', 'remote.origin.url', join(root, 'nowhere'));
  git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  const read = (path) => readFileSync(join(root, path), 'utf8');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`!!${item('feature')}`);
  const names = await page.evaluate(`[...document.querySelectorAll('.ref-item[data-ref]')].map(r => r.dataset.ref).join(',')`);
  check('left panel lists local and remote branches', names === 'feature,main,origin/review', names);
  check('current branch marked', await page.evaluate(`${item('main')}.classList.contains('current')`));

  // Clicking a branch selects its commit.
  await page.click(item('feature'));
  check('clicking a branch selects its commit', (await page.waitFor(`document.querySelector('.commit-details .commit-subject')?.textContent`)) === 'Feature change');
  await page.click(`document.querySelector('.close-details')`);

  // Double-click with a change that does not conflict: carried over.
  write('other.txt', 'my edit\n');
  await page.waitFor(`[...document.querySelectorAll('.change-item')].some(b => b.textContent.includes('other.txt'))`, 5000);
  await doubleClick(page, item('feature'));
  check('double-click checks out the branch', (await page.waitFor(`${currentBranch} === 'feature' && ${currentBranch}`)) === 'feature');
  check('uncommitted change carried over', read('other.txt') === 'my edit\n' && git('stash', 'list') === '');

  // Conflicting change: stash kept, conflict reported.
  write('other.txt', 'other\n');
  write('shared.txt', 'line 1\nline 2 my way\nline 3\n');
  await page.waitFor(`[...document.querySelectorAll('.change-item')].some(b => b.textContent.includes('shared.txt'))`, 5000);
  await doubleClick(page, item('main'));
  const notice = await page.waitFor(`document.querySelector('.notices')?.textContent`);
  check('conflict on the way back is reported', /Switched to main\. .*conflict.*shared\.txt.*kept in the stash/.test(notice ?? ''), notice);
  check('…the stash is kept', /Forklift: changes from before switching to main/.test(git('stash', 'list')));
  check('…and the conflict is in the working tree', /<<<<<<</.test(read('shared.txt')));
  git('reset', '-q', '--hard');
  git('stash', 'clear');
  await page.click(`[...document.querySelectorAll('.notices button')].find(b => b.textContent === 'Dismiss')`);

  // Create a branch from the context menu: invalid name rejected live, then created and checked out.
  await page.waitFor(`${currentBranch} === 'main'`, 5000);
  await contextMenu(page, item('feature'));
  await page.click(menuItem('Create branch here…'));
  await page.fill(`document.querySelector('.form-dialog input[name="name"]')`, 'bad name');
  const invalid = await page.waitFor(`document.querySelector('.form-dialog .setting-error')?.textContent`);
  check('invalid branch name explained in the dialog', /not a valid branch name/.test(invalid ?? ''), invalid);
  check('…and the button disabled', await page.evaluate(`document.querySelector('.form-dialog button[type=submit]').disabled`));
  await page.fill(`document.querySelector('.form-dialog input[name="name"]')`, 'topic/one');
  await page.waitFor(`!document.querySelector('.form-dialog button[type=submit]').disabled`);
  await page.click(`document.querySelector('.form-dialog button[type=submit]')`);
  check('branch created from the dialog and checked out', (await page.waitFor(`${currentBranch} === 'topic/one' && ${currentBranch}`)) === 'topic/one');
  check('…at the chosen commit', git('rev-parse', 'topic/one') === git('rev-parse', 'feature'));

  // Rename.
  await contextMenu(page, item('topic/one'));
  await page.click(menuItem('Rename…'));
  await page.fill(`document.querySelector('.form-dialog input[name="name"]')`, 'topic/renamed');
  await page.waitFor(`!document.querySelector('.form-dialog button[type=submit]').disabled`);
  await page.click(`document.querySelector('.form-dialog button[type=submit]')`);
  check('branch renamed', await page.waitFor(`!!${item('topic/renamed')} && !${item('topic/one')}`));

  // Delete an unmerged branch: asks again before forcing.
  await doubleClick(page, item('main'));
  await page.waitFor(`${currentBranch} === 'main'`);
  await contextMenu(page, item('topic/renamed'));
  await page.click(menuItem('Delete…'));
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Delete')`);
  const second = await page.waitFor(`document.querySelector('.modal h2')?.textContent.includes('not merged') && document.querySelector('.modal h2').textContent`);
  check('unmerged branch: second confirmation', /topic\/renamed is not merged/.test(second ?? ''), second);
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Delete anyway')`);
  check('…then deleted', await page.waitFor(`!${item('topic/renamed')}`));

  // Annotated tag from the graph's context menu, then deleted from the left panel.
  await contextMenu(page, `[...document.querySelectorAll('.commit-row[data-hash]')].find(r => r.textContent.includes('Base'))`);
  await page.click(menuItem('Create tag here…'));
  await page.fill(`document.querySelector('.form-dialog input[name="name"]')`, 'v1.0');
  await page.evaluate(`document.querySelector('.form-dialog textarea').focus()`);
  await page.insertText('First release');
  await page.waitFor(`!document.querySelector('.form-dialog button[type=submit]').disabled`);
  await page.click(`document.querySelector('.form-dialog button[type=submit]')`);
  check('annotated tag created on the commit', await page.waitFor(`!!${item('v1.0')}`) && git('cat-file', '-t', 'v1.0') === 'tag' && git('rev-parse', 'v1.0^{commit}') === git('rev-parse', 'main~0'));
  check('tag shown in the graph', await page.waitFor(`[...document.querySelectorAll('.ref.tag')].some(r => r.textContent === 'v1.0')`));
  await contextMenu(page, item('v1.0'));
  await page.click(menuItem('Delete tag…'));
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Delete')`);
  check('tag deleted', await page.waitFor(`!${item('v1.0')}`) && git('tag') === '');

  // A remote branch: double-click creates a local tracking branch.
  await doubleClick(page, item('origin/review'));
  check('remote branch checked out as a tracking branch', (await page.waitFor(`${currentBranch} === 'review' && ${currentBranch}`)) === 'review');
  check('…tracking origin/review', git('rev-parse', '--abbrev-ref', 'review@{upstream}') === 'origin/review');
}
