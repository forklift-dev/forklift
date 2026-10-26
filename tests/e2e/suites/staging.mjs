// Index work through the real UI: hunk glyphs, line discard with confirmation, unstage, file rows, commit, amend, hooks.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, sleep } from '../harness.mjs';

export default async function ({ check, artifactsDir }) {
  const { root, git, write } = createRepo();
  const ten = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  write('f.txt', ten);
  write('g.txt', 'g\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  write('f.txt', ten.replace('line 2\n', 'LINE TWO\n').replace('line 9\n', 'LINE NINE\n'));
  write('g.txt', 'g changed\n');
  write('junk.tmp', 'junk\n');
  const staged = (path) => git('diff', '--cached', '--', path);

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`document.querySelectorAll('.change-item').length === 3`);
  const glyphs = `document.querySelectorAll('.monaco-diff-editor .editor.modified .hunk-glyph')`;

  // 1. Stage the first hunk with its glyph.
  await page.click(`[...document.querySelectorAll('.change-item')].find(b => b.textContent.includes('f.txt'))`);
  check('two hunk glyphs on the modified side', await page.waitFor(`${glyphs}.length === 2`));
  await page.click(`[...${glyphs}].sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y)[0]`);
  await page.waitFor(`/Staged/.test(document.querySelector('.side').textContent)`);
  const afterHunk = staged('f.txt');
  check('glyph staged exactly the first hunk', afterHunk.includes('+LINE TWO') && !afterHunk.includes('LINE NINE'), afterHunk.replace(/\n/g, '⏎'));
  check('unstaged diff now has one hunk left', await page.waitFor(`${glyphs}.length === 1`));
  if (process.env.E2E_SCREENSHOTS) await page.screenshot(join(artifactsDir, 'staging.png'));

  // 2. Discard a line: cursor on the added "LINE NINE" → Discard lines → confirm.
  await page.click(`[...document.querySelectorAll('.monaco-diff-editor .editor.modified .view-line')].find(l => /LINE.NINE/.test(l.textContent))`);
  await page.click(`[...document.querySelectorAll('.diff-toolbar button')].find(b => b.textContent === 'Discard lines')`);
  const dialogTitle = await page.waitFor(`document.querySelector('.modal h2')?.textContent`);
  check('discard asks for confirmation', /Discard the selected changes in f\.txt/.test(dialogTitle ?? ''), dialogTitle);
  check('Cancel is focused by default', (await page.evaluate(`document.activeElement?.textContent`)) === 'Cancel');
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Discard')`);
  await page.waitFor(`!document.querySelector('.modal')`);
  await sleep(500);
  const worktree = readFileSync(join(root, 'f.txt'), 'utf8');
  // Only the picked addition is dropped; the unpicked removal of "line 9" stays applied.
  check('discarded only the picked added line', !worktree.includes('LINE NINE') && !worktree.includes('line 9\n') && worktree.includes('LINE TWO'), worktree.replace(/\n/g, '⏎'));

  // 3. Unstage the hunk from the staged diff.
  await page.click(`[...document.querySelectorAll('.change-group')].find(g => g.textContent.startsWith('Staged')).querySelector('.change-item')`);
  await page.waitFor(`document.querySelector('.diff-subtitle')?.textContent === 'Staged' && document.querySelectorAll('.monaco-diff-editor .editor.modified .hunk-glyph.codicon-remove').length === 1`);
  await page.click(`document.querySelector('.monaco-diff-editor .editor.modified .hunk-glyph')`);
  await page.waitFor(`!/Staged/.test(document.querySelector('.side').textContent)`);
  check('unstage hunk emptied the index', staged('f.txt') === '');

  // 4. Whole files: stage g.txt with its row button, discard the untracked file (confirmed).
  await page.press('Escape');
  await page.evaluate(`[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('g.txt')).querySelector('[aria-label="Stage"]').click()`);
  await page.waitFor(`/Staged.*g\\.txt/.test(document.querySelector('.side').textContent)`);
  check('row button staged g.txt', staged('g.txt').includes('+g changed'));
  await page.evaluate(`[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('junk.tmp')).querySelector('[aria-label="Discard changes"]').click()`);
  const untrackedDetail = await page.waitFor(`document.querySelector('.modal p')?.textContent`);
  check('untracked discard warns about deletion', /1 untracked file will be deleted/.test(untrackedDetail ?? ''), untrackedDetail);
  await page.evaluate(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Discard').click()`);
  await page.waitFor(`!document.querySelector('.modal')`);
  for (let i = 0; i < 20 && existsSync(join(root, 'junk.tmp')); i++) await sleep(100);
  check('untracked file deleted', !existsSync(join(root, 'junk.tmp')));

  // 5. Commit.
  const commitLabel = await page.evaluate(`document.querySelector('.commit-panel button[type=submit]').textContent`);
  check('commit button counts staged files', commitLabel === 'Commit 1 file', commitLabel);
  await page.evaluate(`document.querySelector('.commit-summary').focus()`);
  await page.insertText('Update g');
  await page.evaluate(`document.querySelector('.commit-description').focus()`);
  await page.insertText('Explain why.');
  await page.evaluate(`document.querySelector('.commit-panel button[type=submit]').click()`);
  await page.waitFor(`document.querySelector('.commit-row[data-hash] .subject')?.textContent.includes('Update g')`);
  check('commit created with subject and body', git('log', '-1', '--format=%B').trim() === 'Update g\n\nExplain why.', git('log', '-1', '--format=%B'));
  check('commit form cleared', (await page.evaluate(`document.querySelector('.commit-summary').value`)) === '');

  // 6. Amend prefills the last message.
  await page.evaluate(`document.querySelector('.commit-actions input[type=checkbox]').click()`);
  const prefilled = await page.waitFor(`document.querySelector('.commit-summary').value`);
  check('amend prefills the last message', prefilled === 'Update g' && (await page.evaluate(`document.querySelector('.commit-description').value`)) === 'Explain why.', prefilled);
  await page.evaluate(`document.querySelector('.commit-actions input[type=checkbox]').click()`);

  // 7. A failing pre-commit hook: its output is shown and the message kept.
  writeFileSync(join(root, '.git/hooks/pre-commit'), '#!/bin/sh\necho "lint: missing semicolon in f.txt:2"\nexit 1\n');
  chmodSync(join(root, '.git/hooks/pre-commit'), 0o755);
  await page.evaluate(`[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('f.txt')).querySelector('[aria-label="Stage"]').click()`);
  await page.waitFor(`/Staged.*f\\.txt/.test(document.querySelector('.side').textContent)`);
  await page.evaluate(`(() => { const i = document.querySelector('.commit-summary'); i.focus(); i.select(); })()`);
  await page.insertText('Blocked by hook');
  await page.evaluate(`document.querySelector('.commit-panel button[type=submit]').click()`);
  const banner = await page.waitFor(`document.querySelector('.error-banner')?.textContent`);
  check('hook output shown in the banner', /Commit failed:[\s\S]*lint: missing semicolon in f\.txt:2/.test(banner ?? ''), banner);
  check('message kept after a failed commit', (await page.evaluate(`document.querySelector('.commit-summary').value`)) === 'Blocked by hook');

  // 8. A long list (a build folder nobody ignored): only the visible rows exist, scrolling shows the rest,
  // and "Stage all" takes every file in one go (paths go to git through stdin).
  rmSync(join(root, '.git/hooks/pre-commit'));
  mkdirSync(join(root, 'build'));
  for (let i = 0; i < 2000; i++) writeFileSync(join(root, 'build', `out-${String(i).padStart(4, '0')}.o`), `${i}\n`);
  await page.invoke('repo:refresh', root);
  await page.waitFor(`/Unstaged\\s*20\\d\\d/.test(document.querySelector('.side').textContent)`, 15000);
  const drawn = await page.evaluate(`document.querySelectorAll('.change-row').length`);
  check('a list of 2000 changes draws only the visible rows', drawn > 0 && drawn < 300, drawn);
  await page.evaluate(`document.querySelector('.changes').scrollTop = 1e9`);
  check('scrolling to the end shows the last file', await page.waitFor(`[...document.querySelectorAll('.change-item')].some(b => b.textContent.includes('out-1999.o'))`));
  await page.click(`[...document.querySelectorAll('.group-header')].find(h => /Unstaged/.test(h.textContent)).querySelector('[aria-label="Stage all"]')`);
  const stagedShown = await page.waitFor(`!/Unstaged/.test(document.querySelector('.side').textContent) && /Staged\\s*20\\d\\d/.test(document.querySelector('.side').textContent)`, 20000);
  const stagedInGit = git('diff', '--cached', '--name-only', '--', 'build').split('\n').filter(Boolean).length;
  check('"Stage all" stages all of them', stagedShown && stagedInGit === 2000, `${stagedShown} ${stagedInGit}`);
}
