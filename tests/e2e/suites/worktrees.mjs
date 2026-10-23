// Working trees: the list in the left panel, a new tree for a branch (from the branch menu) and for a new
// branch (from "+"), each opening in a tab; lock, remove (its tab closes), and prune a missing one.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, tempDir } from '../harness.mjs';

const menuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === ${JSON.stringify(label)})`;
const treeRow = (path) => `document.querySelector('.ref-item[data-worktree=${JSON.stringify(path)}]')`;
const dialogButton = (label) => `[...document.querySelectorAll('.form-dialog button, .modal button')].find(b => b.textContent === ${JSON.stringify(label)})`;
const repoName = `document.querySelector('.toolbar-repo strong, .toolbar-repo')?.textContent`;
async function contextMenu(page, expression) {
  await page.evaluate(`(() => { const el = ${expression}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 8 })); })()`);
  await page.waitFor(`!!document.querySelector('.context-menu')`);
}

export default async function ({ check }) {
  const work = tempDir('forklift-worktrees-');
  const { root, git, write } = createRepo({ dir: join(work, 'repo') });
  write('a.txt', 'a\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  git('branch', 'topic');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  check('the main working tree is listed as this tab', await page.waitFor(`/this tab, main/.test(${treeRow(root)}?.textContent ?? '')`, 5000));

  // For an existing branch, from its menu.
  await contextMenu(page, `document.querySelector('.ref-item[data-ref="topic"]')`);
  await page.click(menuItem('Check out in a new working tree…'));
  const topicPath = join(work, 'repo-topic');
  check('the dialog proposes the branch and a folder next to the repository', await page.waitFor(`document.querySelector('.form-dialog [name="branch"]')?.value === 'topic' && document.querySelector('.form-dialog [name="path"]').value === ${JSON.stringify(topicPath)}`));
  await page.waitFor(`!${dialogButton('Create')}.disabled`);
  await page.click(dialogButton('Create'));
  check('the new working tree opens in a tab', await page.waitFor(`/repo-topic/.test(${repoName} ?? '')`, 10000) && existsSync(join(topicPath, 'a.txt')));
  check('there it is the current one', await page.waitFor(`/this tab/.test(${treeRow(topicPath)}?.textContent ?? '')`, 5000));

  // For a new branch, from "+".
  await page.invoke('repo:activate', root);
  await page.waitFor(`!!${treeRow(topicPath)}`, 5000);
  await page.click(`document.querySelector('[aria-label="Add a working tree"]')`);
  await page.fill(`document.querySelector('.form-dialog [name="newBranch"]')`, 'fresh');
  const freshPath = join(work, 'fresh-tree');
  await page.fill(`document.querySelector('.form-dialog [name="path"]')`, freshPath);
  await page.waitFor(`!${dialogButton('Create')}.disabled`);
  await page.click(dialogButton('Create'));
  check('a working tree with a new branch', await page.waitFor(`/fresh-tree/.test(${repoName} ?? '')`, 10000) && git('branch', '--list', 'fresh').includes('fresh'));

  // Lock, then remove from the main tree: its tab closes.
  await page.invoke('repo:activate', root);
  await page.waitFor(`!!${treeRow(topicPath)}`, 5000);
  await contextMenu(page, treeRow(topicPath));
  await page.click(menuItem('Lock'));
  check('a locked tree says so', await page.waitFor(`/locked/.test(${treeRow(topicPath)}?.textContent ?? '')`, 5000));
  await contextMenu(page, treeRow(topicPath));
  check('a locked tree cannot be removed', await page.evaluate(`${menuItem('Remove working tree…')}.disabled`));
  await page.click(menuItem('Unlock'));
  await page.waitFor(`!/locked/.test(${treeRow(topicPath)}?.textContent ?? 'locked')`, 5000);
  await contextMenu(page, treeRow(topicPath));
  await page.click(menuItem('Remove working tree…'));
  await page.click(dialogButton('Remove'));
  check('removing deletes the folder and closes its tab', (await page.waitFor(`!${treeRow(topicPath)} && ![...document.querySelectorAll('.tab-bar .tab, .tab-bar [role="tab"]')].some(t => t.textContent.includes('repo-topic'))`, 10000)) && !existsSync(topicPath));

  // A tree whose folder vanished: prune.
  await page.invoke('repo:close', freshPath);
  rmSync(freshPath, { recursive: true, force: true });
  await page.invoke('repo:refresh', root);
  check('a missing working tree is marked', await page.waitFor(`/missing/.test(${treeRow(freshPath)}?.textContent ?? '')`, 5000));
  await contextMenu(page, treeRow(freshPath));
  await page.click(menuItem('Prune missing working trees'));
  check('prune forgets it', await page.waitFor(`!${treeRow(freshPath)}`, 5000));
}
