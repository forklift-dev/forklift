// Conflict resolution in the app: operation banner, the three-pane editor (take ours/theirs/both, save and mark
// resolved, stale file protection), whole-file sides including deletions, committing a merge, aborting a rebase.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp } from '../harness.mjs';

const banner = `document.querySelector('.operation-banner')?.textContent`;
const button = (scope, label) => `[...document.querySelectorAll('${scope} button')].find(b => b.textContent === ${JSON.stringify(label)})`;
const conflictItem = (name) => `[...document.querySelectorAll('.changes .change-item')].find(b => b.textContent.includes(${JSON.stringify(name)}))`;
const subtitle = `document.querySelector('.conflict-view .diff-subtitle')?.textContent`;

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  const lines = (two, nine) => ['one', two, 'three', 'four', 'five', 'six', 'seven', 'eight', nine, 'ten', ''].join('\n');
  write('app.txt', lines('two', 'nine'));
  write('gone.txt', 'base\n');
  git('add', '.');
  git('commit', '-qm', 'Base');
  git('switch', '-qc', 'feature');
  write('app.txt', lines('TWO feature', 'NINE feature'));
  git('rm', '-q', 'gone.txt');
  git('commit', '-qam', 'Feature');
  git('switch', '-q', 'main');
  write('app.txt', lines('TWO main', 'NINE main'));
  write('gone.txt', 'edited on main\n');
  git('commit', '-qam', 'Main');
  git.allowFail('merge', 'feature');
  const read = (path) => readFileSync(join(root, path), 'utf8');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  check('banner shows the merge and its conflicts', /Merging feature — 2 conflicted files to resolve/.test((await page.waitFor(banner)) ?? ''), await page.evaluate(banner));
  check('commit merge disabled while conflicts remain', await page.evaluate(`${button('.operation-banner', 'Commit merge')}.disabled`));

  await page.click(conflictItem('app.txt'));
  check('conflict editor opens with both blocks', (await page.waitFor(`${subtitle}?.endsWith('of 2') && ${subtitle}`)) === 'Conflict 1 of 2', await page.evaluate(subtitle));
  const sides = await page.evaluate(`[...document.querySelectorAll('.conflict-pane-title')].map(t => t.textContent).join(' | ')`);
  check('ours and theirs panes labelled', /Ours — HEAD \| Theirs — feature/.test(sides), sides);

  // Stale protection: the file changes on disk before saving.
  await page.click(button('.conflict-view', 'Take theirs'));
  await page.waitFor(`${subtitle} === 'Conflict 1 of 1'`);
  appendFileSync(join(root, 'app.txt'), 'changed elsewhere\n');
  await page.click(button('.conflict-view', 'Save'));
  check('a file changed on disk is not overwritten', /changed on disk/.test((await page.waitFor(`document.querySelector('.error-banner')?.textContent`)) ?? ''));
  await page.click(`document.querySelector('[aria-label="Close conflict editor"]')`);
  check('closing with unsaved edits asks first', /Close without saving/.test((await page.waitFor(`document.querySelector('.modal h2')?.textContent`)) ?? ''));
  await page.click(button('.modal', 'Close'));
  git('checkout', '-q', '--merge', '--', 'app.txt'); // recreate the conflict markers

  await page.click(conflictItem('app.txt'));
  await page.waitFor(`${subtitle} === 'Conflict 1 of 2'`);
  await page.click(button('.conflict-view', 'Take theirs'));
  await page.waitFor(`${subtitle} === 'Conflict 1 of 1'`);
  await page.click(button('.conflict-view', 'Take both'));
  check('all blocks resolved in the editor', (await page.waitFor(`${subtitle} === 'No conflicts left' && ${subtitle}`)) === 'No conflicts left');
  await page.click(button('.conflict-view', 'Save and mark resolved'));
  await page.waitFor(`!document.querySelector('.conflict-view')`);
  check('result saved', read('app.txt') === ['one', 'TWO feature', 'three', 'four', 'five', 'six', 'seven', 'eight', 'NINE main', 'NINE feature', 'ten', ''].join('\n'), JSON.stringify(read('app.txt')));
  check('…and staged as resolved', git('diff', '--name-only', '--diff-filter=U') === 'gone.txt');

  // gone.txt: deleted by feature → "Use their file" deletes it.
  await page.click(conflictItem('gone.txt'));
  await page.waitFor(`!!document.querySelector('.conflict-view')`);
  check('a deleted side is explained', await page.waitFor(`[...document.querySelectorAll('.conflict-pane .diff-message')].some(m => m.textContent === 'Deleted on this side')`));
  await page.click(button('.conflict-view', 'Use their file'));
  check('taking the deleting side removes the file', await page.waitFor(`!document.querySelector('.conflict-view')`) && !existsSync(join(root, 'gone.txt')));

  check('banner: all resolved', /all conflicts resolved/.test((await page.waitFor(`/all conflicts resolved/.test(${banner}) && ${banner}`)) ?? ''));
  await page.click(button('.operation-banner', 'Commit merge'));
  check('merge committed, banner gone', await page.waitFor(`!document.querySelector('.operation-banner')`) && git('log', '-1', '--format=%P').split(' ').length === 2);

  // A rebase that stops on a conflict, then is aborted.
  git('switch', '-qc', 'topic', 'HEAD~1');
  write('app.txt', 'topic version\n');
  git('commit', '-qam', 'Topic');
  git.allowFail('rebase', 'main');
  check('rebase progress shown', /Rebasing topic \(commit 1 of 1\)/.test((await page.waitFor(`/Rebasing/.test(${banner}) && ${banner}`)) ?? ''), await page.evaluate(banner));
  await page.click(button('.operation-banner', 'Abort'));
  await page.click(button('.modal', 'Abort'));
  check('rebase aborted', await page.waitFor(`!document.querySelector('.operation-banner')`) && git('rev-parse', '--abbrev-ref', 'HEAD') === 'topic' && read('app.txt') === 'topic version\n');
}
