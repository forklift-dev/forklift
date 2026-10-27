// Compare divergent commits and branches: direct and merge-base modes, file diff and bounded history.
import { createRepo, launchApp } from '../harness.mjs';

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('shared.txt', 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'side');
  write('shared.txt', 'side\n');
  write('side.txt', 'from side\n');
  git('add', '.');
  git('commit', '-qm', 'side');
  const side = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  write('shared.txt', 'main\n');
  write('main.txt', 'from main\n');
  git('add', '.');
  git('commit', '-qm', 'main');
  const main = git('rev-parse', 'HEAD');

  const { page } = await launchApp();
  check('repository opened', (await page.invoke('repo:open', root))?.ok === true);
  await page.waitFor(`document.querySelectorAll('.commit-row[data-hash]').length === 3`);
  await page.click(`document.querySelector('.commit-row[data-hash="${main}"]')`);
  await page.evaluate(`document.querySelector('.commit-row[data-hash="${side}"]').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`);
  const files = await page.waitFor(`document.querySelectorAll('.comparison-panel .change-row').length === 3 && [...document.querySelectorAll('.comparison-panel .change-item')].map(e => e.textContent.trim()).join('|')`);
  check('Ctrl+click compares both commit trees', files?.includes('main.txt') && files?.includes('side.txt') && files?.includes('shared.txt'), files);
  check('both commits remain highlighted', await page.evaluate(`!!document.querySelector('.commit-row[data-hash="${main}"].selected') && !!document.querySelector('.commit-row[data-hash="${side}"].comparison-selected')`));

  await page.click(`document.querySelector('.comparison-modes button:last-child')`);
  const fromBase = await page.waitFor(`document.querySelectorAll('.comparison-panel .change-row').length === 2 && [...document.querySelectorAll('.comparison-panel .change-item')].map(e => e.textContent.trim()).join('|')`);
  check('A...B excludes changes made only on A', fromBase?.includes('side.txt') && !fromBase?.includes('main.txt'), fromBase);

  await page.click(`[...document.querySelectorAll('.comparison-panel .change-item')].find(e => e.textContent.includes('shared.txt'))`);
  await page.waitFor(`document.querySelector('.monaco-diff-editor .editor.modified .view-lines')?.textContent.includes('side')`);
  check('file diff uses common ancestor and B', (await page.text('.monaco-diff-editor .editor.original .view-lines'))?.includes('base') && (await page.text('.monaco-diff-editor .editor.modified .view-lines'))?.includes('side'));
  await page.press('Escape');

  await page.click(`[...document.querySelectorAll('.comparison-panel .change-row')].find(e => e.textContent.includes('shared.txt')).querySelector('.row-history')`);
  const history = await page.waitFor(`document.querySelector('.file-history-list') && [...document.querySelectorAll('.history-subject')].map(e => e.textContent).join('|')`);
  check('file history is limited to compared revisions', history === 'side', history);
  await page.click(`document.querySelector('[aria-label="Close file history"]')`);
  await page.click(`document.querySelector('.comparison-panel .close-details')`);

  await page.click(`document.querySelector('.ref-item[data-ref="main"]')`);
  await page.evaluate(`(() => { const el = document.querySelector('.ref-item[data-ref="side"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 8 })); })()`);
  await page.click(`[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === 'Compare with selected commit (A..B)')`);
  check('branches compare from context menu', await page.waitFor(`document.querySelectorAll('.comparison-panel .change-row').length === 3`));
  await page.click(`document.querySelector('.comparison-panel .close-details')`);

  await page.press('P', { code: 'KeyP', keyCode: 80, modifiers: 2 | 8 });
  await page.insertText('compare branches');
  await page.waitFor(`document.querySelector('.palette-item.active')?.textContent.includes('Compare branches')`);
  await page.press('Enter');
  check('command palette opens the comparison picker', await page.waitFor(`document.querySelector('.form-dialog h2')?.textContent === 'Compare revisions'`));
  await page.selectOption(`document.querySelector('.form-dialog select[name="left"]')`, main);
  await page.selectOption(`document.querySelector('.form-dialog select[name="right"]')`, side);
  await page.selectOption(`document.querySelector('.form-dialog select[name="mode"]')`, 'merge-base');
  await page.click(`document.querySelector('.form-dialog button[type="submit"]')`);
  check('picker compares branches in A...B mode', await page.waitFor(`document.querySelectorAll('.comparison-panel .change-row').length === 2 && !!document.querySelector('.comparison-panel .comparison-base')`));
}
