// Undo/Redo from the toolbar and keyboard: a commit, a discard, a branch deletion; refusing after outside changes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp } from '../harness.mjs';

const undoButton = `document.querySelector('[aria-label="Undo"]')`;
const redoButton = `document.querySelector('[aria-label="Redo"]')`;
const idle = `!document.querySelector('.toolbar .spinner')`;
// The HEAD commit's subject (unrelated branch tips made in the same second may sort above it).
const top = `document.querySelector('.commit-row[data-hash]:has(.ref.head) .subject')?.textContent`;

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('f.txt', 'base\n');
  git('add', '.');
  git('commit', '-qm', 'Base');
  git('branch', 'old-work');
  write('f.txt', 'edit\n');
  const read = (path) => readFileSync(join(root, path), 'utf8');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`[...document.querySelectorAll('.change-item')].some(b => b.textContent.includes('f.txt'))`);
  check('nothing to undo at first', await page.evaluate(`${undoButton}.disabled`));

  // Commit through the UI, then undo it.
  await page.evaluate(`[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('f.txt')).querySelector('[aria-label="Stage"]').click()`);
  await page.waitFor(`/Staged/.test(document.querySelector('.side').textContent) && ${idle}`);
  await page.evaluate(`document.querySelector('.commit-summary').focus()`);
  await page.insertText('Edit f');
  await page.click(`document.querySelector('.commit-panel button[type=submit]')`);
  await page.waitFor(`${top} === 'Edit f' && ${idle}`);
  check('undo names the commit', /Undo commit “Edit f”/.test((await page.evaluate(`${undoButton}.title`)) ?? ''));
  await page.click(undoButton);
  check('undo removes the commit and keeps its changes staged', (await page.waitFor(`${top} === 'Base' && ${idle}`)) && git('diff', '--cached', '--name-only') === 'f.txt');
  await page.click(redoButton);
  check('redo brings it back', await page.waitFor(`${top} === 'Edit f' && ${idle}`));

  // Discard and Ctrl+Z.
  write('f.txt', 'precious unsaved work\n');
  await page.waitFor(`[...document.querySelectorAll('.change-row')].some(r => r.textContent.includes('f.txt'))`, 5000);
  await page.evaluate(`[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('f.txt')).querySelector('[aria-label="Discard changes"]').click()`);
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Discard')`);
  await page.waitFor(`${idle} && !document.querySelector('.modal')`);
  check('discarded', read('f.txt') === 'edit\n');
  await page.evaluate(`document.querySelector('.commit-scroll').focus()`);
  await page.press('z', { code: 'KeyZ', keyCode: 90, modifiers: 2 });
  check('Ctrl+Z restores the discarded work', (await page.waitFor(`${idle} && document.querySelector('.change-row') !== null`)) && read('f.txt') === 'precious unsaved work\n');

  // Delete a branch, undo.
  const sha = git('rev-parse', 'old-work');
  await page.evaluate(`(() => { const el = document.querySelector('.ref-item[data-ref="old-work"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 8 })); })()`);
  await page.click(`[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === 'Delete…')`);
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Delete')`);
  await page.waitFor(`!document.querySelector('.ref-item[data-ref="old-work"]') && ${idle}`);
  await page.click(undoButton);
  check('undo brings the deleted branch back', (await page.waitFor(`!!document.querySelector('.ref-item[data-ref="old-work"]')`)) && git('rev-parse', 'old-work') === sha);

  // Something else moves HEAD: undo refuses and explains.
  write('f.txt', 'x\n');
  await page.evaluate(`[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('f.txt'))?.querySelector('[aria-label="Stage"]')?.click()`);
  await page.waitFor(idle);
  git('commit', '-qam', 'From a terminal');
  await page.waitFor(`${top} === 'From a terminal'`, 5000);
  await page.click(undoButton);
  const refusal = await page.waitFor(`document.querySelector('.error-banner')?.textContent`);
  check('undo refuses after outside changes', /changed since then/.test(refusal ?? ''), refusal);
  check('…and the history is cleared', await page.waitFor(`${undoButton}.disabled`));
  check('push says it cannot be undone', /cannot be undone/.test((await page.evaluate(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Push').title`)) ?? ''));
  check('no leftovers', !existsSync(join(root, '.git', 'index.lock')));
}
