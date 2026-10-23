// Git LFS without git-lfs installed (the usual case on a fresh machine): the warning, LFS files marked in the
// changes, a diff showing a downloaded object's content and a missing object's pointer, and the LFS dialog.
// With git-lfs installed, tracking a pattern is checked too.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, tempDir } from '../harness.mjs';

const CTRL = 2;
const SHIFT = 8;
const hasLfs = (() => {
  try {
    execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const pointer = (content) => {
  const oid = createHash('sha256').update(content).digest('hex');
  return { oid, text: `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${Buffer.byteLength(content)}\n` };
};

export default async function ({ check }) {
  const { root, git, write } = createRepo({ dir: join(tempDir('forklift-lfs-'), 'repo') });
  const first = pointer('first version\n');
  const second = pointer('second version\n');
  write('.gitattributes', '*.bin filter=lfs diff=lfs merge=lfs -text\n');
  write('data.bin', first.text);
  write('README.md', 'readme\n');
  // Committed as pointers, the way git-lfs stores them (no filter runs without git-lfs).
  git('-c', 'filter.lfs.clean=cat', '-c', 'filter.lfs.smudge=cat', 'add', '.');
  git('commit', '-qm', 'lfs');
  const store = join(root, '.git', 'lfs', 'objects', first.oid.slice(0, 2), first.oid.slice(2, 4));
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, first.oid), 'first version\n');
  write('data.bin', second.text);
  write('README.md', 'readme 2\n');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.change-row')`);
  if (!hasLfs) check('a warning says git-lfs is missing', await page.waitFor(`/uses Git LFS, but git-lfs is not installed/.test(document.querySelector('.lfs-missing')?.textContent ?? '')`, 5000));
  check('LFS files are marked in the changes', await page.waitFor(`[...document.querySelectorAll('.change-row')].some(r => r.textContent.includes('data.bin') && !!r.querySelector('.lfs-badge')) && [...document.querySelectorAll('.change-row')].some(r => r.textContent.includes('README.md') && !r.querySelector('.lfs-badge'))`, 5000));

  await page.click(`[...document.querySelectorAll('.change-item')].find(b => b.textContent.includes('data.bin'))`);
  await page.waitFor(`!!document.querySelector('.monaco-diff-editor .editor.original .view-lines')`, 5000);
  // Monaco renders spaces as no-break spaces.
  const text = (side) => `document.querySelector('.monaco-diff-editor .editor.${side} .view-lines')?.textContent.replace(/\u00a0/g, ' ')`;
  const original = await page.waitFor(text('original'));
  check('a downloaded object shows its content', /first version/.test(original ?? ''), original);
  const note = await page.waitFor(`document.querySelector('.lfs-note')?.textContent`);
  check('a missing object shows its pointer, and says so', /not downloaded/.test(note ?? '') && /oid sha256/.test((await page.evaluate(text('modified'))) ?? ''), note);
  check('LFS files are not staged line by line', await page.evaluate(`!document.querySelector('.hunk-actions button, .diff-toolbar [aria-label="Stage lines"]:not([disabled])')`));
  await page.press('Escape');

  await page.press('P', { code: 'KeyP', keyCode: 80, modifiers: CTRL | SHIFT });
  await page.insertText('lfs track');
  await page.waitFor(`document.querySelector('.palette-item.active')?.textContent.includes('Track or untrack files')`);
  await page.press('Enter');
  check('the LFS dialog lists the patterns', await page.waitFor(`[...document.querySelectorAll('.lfs-patterns code')].map(c => c.textContent).join() === '*.bin'`, 5000));
  if (!hasLfs) {
    check('without git-lfs it explains and cannot track', await page.evaluate(`/git-lfs is not installed/.test(document.querySelector('.lfs-dialog').textContent) && document.querySelector('.lfs-dialog [name="pattern"]').disabled`));
  } else {
    await page.fill(`document.querySelector('.lfs-dialog [name="pattern"]')`, '*.psd');
    await page.click(`[...document.querySelectorAll('.lfs-dialog button')].find(b => b.textContent === 'Track')`);
    check('tracking adds the pattern', await page.waitFor(`[...document.querySelectorAll('.lfs-patterns code')].some(c => c.textContent === '*.psd')`, 5000) && /\*\.psd filter=lfs/.test(readFileSync(join(root, '.gitattributes'), 'utf8')));
  }
}
