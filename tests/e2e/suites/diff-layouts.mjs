// Hunk and File layouts: same changes as Split, git-style hunk headers, staging a hunk or picked lines from
// the Hunks view and a hunk from the File view gives the same index as the other layouts.
import { createRepo, launchApp } from '../harness.mjs';

const layout = `document.querySelector('[aria-label="Diff layout"]')`;
const count = `document.querySelector('.diff-count')?.textContent`;

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  const ten = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  write('f.txt', ten);
  git('add', '.');
  git('commit', '-qm', 'base');
  write('f.txt', ten.replace('line 2\n', 'LINE TWO\n').replace('line 12\n', '').replace('line 18\n', 'line 18\nNEW 18b\n'));
  const staged = () => git('diff', '--cached', '--', 'f.txt');
  const reset = () => git('reset', '-q', '--', 'f.txt');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.click(`[...document.querySelectorAll('.change-item')].find(b => b.textContent.includes('f.txt'))`);
  const splitCount = await page.waitFor(`/changes?/.test(${count} ?? '') && ${count}`);

  await page.selectOption(layout, 'hunk');
  const headers = await page.waitFor(`[...document.querySelectorAll('.hunk-header code')].map(c => c.textContent).join(' | ')`);
  check('Hunks shows the same changes as Split, with git headers', headers === '@@ -2 +2 @@ | @@ -12 +11,0 @@ | @@ -18,0 +18 @@' && (await page.evaluate(count)) === splitCount, `${headers} / ${splitCount}`);
  check('three lines of context around a change', (await page.evaluate(`document.querySelectorAll('.hunk')[1].querySelectorAll('.hunk-line.context').length`)) === 6);

  await page.click(`[...document.querySelectorAll('.hunk')][1].querySelector('.hunk-actions button')`);
  await page.waitFor(`document.querySelectorAll('.hunk').length === 2`, 5000);
  check('Stage hunk from Hunks stages exactly that hunk', /-line 12/.test(staged()) && !/LINE TWO/.test(staged()), staged());
  reset();

  await page.waitFor(`document.querySelectorAll('.hunk').length === 3 && !document.querySelector('.toolbar .spinner')`, 5000);
  await page.click(`[...document.querySelectorAll('.hunk-line.added')].find(l => l.textContent.includes('LINE TWO'))`);
  check('a clicked line is picked', await page.waitFor(`!!document.querySelector('.hunk-line.added.picked')`));
  await page.click(`[...document.querySelectorAll('.diff-toolbar button')].find(b => b.textContent === 'Stage lines')`);
  for (let i = 0; i < 40 && !/LINE TWO/.test(staged()); i++) await new Promise((r) => setTimeout(r, 100));
  const picked = staged();
  check('picking a line in Hunks stages just that line', /\+LINE TWO/.test(picked) && !/-line 2\b/.test(picked) && !/line 12/.test(picked), picked.replace(/\n/g, '⏎'));
  reset();

  await page.waitFor(`!document.querySelector('.toolbar .spinner')`);
  await page.selectOption(layout, 'file');
  check('File shows the whole new file with highlights', await page.waitFor(`!!document.querySelector('.file-view .file-view-added, .file-view .file-view-changed')`));
  const lineCount = await page.evaluate(`document.querySelectorAll('.file-view .view-line').length`);
  check('…all of it', lineCount >= 19, String(lineCount));
  await page.waitFor(`document.querySelectorAll('.file-view .hunk-glyph').length === 3 && !document.querySelector('.toolbar .spinner')`, 5000);
  await new Promise((r) => setTimeout(r, 500)); // the file view settles after the refresh that followed the reset
  await page.click(`[...document.querySelectorAll('.file-view .hunk-glyph')].sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y)[0]`);
  for (let i = 0; i < 40 && !/LINE TWO/.test(staged()); i++) await new Promise((r) => setTimeout(r, 100));
  check('Stage hunk from File stages the first hunk', /\+LINE TWO/.test(staged()) && !/line 12/.test(staged()), staged());

  await page.selectOption(layout, 'split');
  check('back to Split', await page.waitFor(`document.querySelector('.monaco-diff-editor')?.classList.contains('side-by-side')`));
}
