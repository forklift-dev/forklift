// File history (following a rename) with the file's diff per commit, blame of the working tree and of a past
// commit, and jumping from a blamed line to its commit in the graph.
import { createRepo, launchApp } from '../harness.mjs';

export default async function ({ check, artifactsDir }) {
  const { root, git, write } = createRepo();
  const commit = (author, message) => {
    git('add', '.');
    git('commit', '-qm', message, `--author=${author} <${author.toLowerCase()}@x>`);
  };
  write('notes.txt', 'alpha\nbeta\ngamma\n');
  commit('Ada', 'Start notes');
  write('notes.txt', 'alpha\nBETA\ngamma\n');
  commit('Grace', 'Shout beta');
  git('mv', 'notes.txt', 'journal.txt');
  commit('Grace', 'Rename to journal');
  write('journal.txt', 'alpha\nBETA\ngamma\ndelta\n');
  commit('Linus', 'Add delta');
  write('journal.txt', 'alpha\nBETA\ngamma\ndelta\nepsilon\n');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.change-row')`);
  await page.evaluate(`[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('journal.txt')).querySelector('[aria-label="File history and blame"]').click()`);
  const entries = await page.waitFor(`[...document.querySelectorAll('.history-subject')].map(s => s.textContent).join(',')`);
  check('history follows the rename', entries === 'Add delta,Rename to journal,Shout beta,Start notes', entries);
  check('the newest change is shown', await page.waitFor(`document.querySelector('.file-history .monaco-diff-editor .editor.modified .view-lines')?.textContent.includes('delta')`));
  await page.click(`[...document.querySelectorAll('.history-entry')].find(b => b.textContent.includes('Shout beta'))`);
  const before = await page.waitFor(`(() => { const t = document.querySelector('.file-history .monaco-diff-editor .editor.original .view-lines')?.textContent; return t?.includes('beta') && t; })()`);
  check('an older commit shows its diff under the old name', /beta/.test(before ?? ''));

  await page.click(`[...document.querySelectorAll('.file-history [role="tab"]')].find(b => b.textContent === 'Blame')`);
  await page.waitFor(`!!document.querySelector('.blame-editor .line-numbers')`);
  const gutter = await page.waitFor(`(() => { const t = [...document.querySelectorAll('.blame-editor .line-numbers')].map(n => n.textContent.replace(/\\u00a0/g, ' ').trim()).filter(Boolean).join(' | '); return t.includes('Not committed') && t; })()`);
  check('blame shows authors per hunk and uncommitted lines', /Ada/.test(gutter) && /Grace/.test(gutter) && /Linus/.test(gutter) && /Not committed yet/.test(gutter), gutter);
  if (process.env.E2E_SCREENSHOTS) await page.screenshot(`${artifactsDir}/blame.png`);

  // Blame at a past commit from the history list.
  await page.click(`[...document.querySelectorAll('.file-history [role="tab"]')].find(b => b.textContent === 'History')`);
  await page.waitFor(`[...document.querySelectorAll('.history-entry')].some(b => b.textContent.includes('Shout beta'))`);
  await page.click(`[...document.querySelectorAll('.history-entry')].find(b => b.textContent.includes('Shout beta'))`);
  await page.click(`[...document.querySelectorAll('.file-history .diff-toolbar button')].find(b => b.textContent === 'Blame here')`);
  const past = await page.waitFor(`(() => { const t = document.querySelector('.blame-editor .view-lines')?.textContent; return t && !t.includes('delta') && t; })()`);
  check('blame at a past commit shows that version', Boolean(past) && /BETA/.test(past), past);

  // Clicking a blamed line's gutter shows its commit in the graph.
  await page.click(`[...document.querySelectorAll('.blame-editor .line-numbers')].find(n => n.textContent.includes('Grace'))`);
  check('clicking the blame gutter shows the commit', (await page.waitFor(`document.querySelector('.commit-details .commit-subject')?.textContent`)) === 'Shout beta');
}
