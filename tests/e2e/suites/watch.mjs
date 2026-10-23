// Changes made outside the app show up without pressing Refresh: edits, new files, git commands in a
// terminal; ignored files do not cause work; an open diff follows the file; the active tab is watched.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, sleep } from '../harness.mjs';

const rows = `[...document.querySelectorAll('.change-item')].map(b => b.textContent.trim()).join(',')`;

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('.gitignore', 'build/\n');
  write('a.txt', 'one\n');
  git('add', '.');
  git('commit', '-qm', 'Initial');
  const other = createRepo();
  other.write('o.txt', 'o\n');
  other.git('add', '.');
  other.git('commit', '-qm', 'Other');

  const { page } = await launchApp();
  await page.invoke('repo:open', other.root);
  await page.invoke('repo:open', root);
  await page.waitFor(`[...document.querySelectorAll('.commit-row[data-hash] .subject')].some((s) => s.textContent === 'Initial')`);

  appendFileSync(join(root, 'a.txt'), 'two\n');
  check('an edit in another program appears', await page.waitFor(`${rows}.includes('a.txt')`, 5000));

  // The open diff follows further edits of the file.
  await page.click(`[...document.querySelectorAll('.change-item')].find(b => b.textContent.includes('a.txt'))`);
  await page.waitFor(`document.querySelector('.monaco-diff-editor .editor.modified .view-lines')?.textContent.includes('two')`);
  appendFileSync(join(root, 'a.txt'), 'three\n');
  check('an open diff shows the new content', await page.waitFor(`document.querySelector('.monaco-diff-editor .editor.modified .view-lines')?.textContent.includes('three')`, 5000));
  await page.press('Escape');

  write('b.txt', 'new\n');
  check('a new file appears', await page.waitFor(`${rows}.includes('b.txt')`, 5000));

  git('add', '.');
  git('commit', '-qm', 'Committed in a terminal');
  check('a commit made with git in a terminal appears in the graph', await page.waitFor(`[...document.querySelectorAll('.commit-row[data-hash] .subject')].some((s) => s.textContent === 'Committed in a terminal')`, 5000));
  check('…and the changes are gone', await page.waitFor(`${rows} === ''`, 5000));

  git('checkout', '-qb', 'topic');
  check('a branch switch in a terminal shows in the toolbar', await page.waitFor(`document.querySelector('.toolbar .branch')?.textContent.startsWith('topic')`, 5000));

  // Ignored output does not trigger reads: loadedAt stays put.
  const before = await page.evaluate(`document.querySelector('.commit-row[data-hash]')?.dataset.hash`);
  write('build/out.js', 'x');
  await sleep(1200);
  check('ignored files change nothing', (await page.evaluate(rows)) === '' && (await page.evaluate(`document.querySelector('.commit-row[data-hash]')?.dataset.hash`)) === before);

  // Switching tabs: the background tab is re-read when shown.
  await page.invoke('repo:activate', other.root);
  await page.waitFor(`document.querySelector('.tab.active .tab-name')?.textContent === ${JSON.stringify(other.root.split('/').pop())}`);
  writeFileSync(join(other.root, 'o.txt'), 'changed\n');
  check('the newly active tab is watched', await page.waitFor(`${rows}.includes('o.txt')`, 5000));
  appendFileSync(join(root, 'a.txt'), 'background\n');
  await page.invoke('repo:activate', root);
  check('a background tab is up to date when shown again', await page.waitFor(`${rows}.includes('a.txt')`, 5000));
  check('no loading flicker from background refreshes', !(await page.evaluate(`!!document.querySelector('.toolbar .spinner')`)));
}
