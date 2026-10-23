// Built-in diff: commit details, Monaco with both versions, inline mode, binary files, working tree, Esc.
import { join } from 'node:path';
import { createRepo, launchApp } from '../harness.mjs';

export default async function ({ check, artifactsDir }) {
  const { root, git, write } = createRepo();
  write('app.ts', 'export function greet(name: string) {\n  return "Hello " + name;\n}\n');
  write('notes.md', '# Notes\n\nfirst\n');
  git('add', '.');
  git('commit', '-qm', 'Initial import');
  write('app.ts', 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n');
  git('mv', 'notes.md', 'README.md');
  write('logo.bin', Buffer.from([0, 1, 2, 3]));
  git('add', '-A');
  git('commit', '-qm', 'Template strings\n\nUse a template literal and an explicit return type.');
  write('app.ts', 'export function greet(name: string): string {\n  return `Hi, ${name}!`;\n}\n'); // unstaged

  const { page } = await launchApp();
  check('repo opened', (await page.invoke('repo:open', root))?.ok === true);
  await page.waitFor(`document.querySelectorAll('.commit-row[data-hash]').length === 2`);

  await page.evaluate(`document.querySelector('.commit-row[data-hash]').click()`);
  const subject = await page.waitFor(`document.querySelector('.commit-details .commit-subject')?.textContent`);
  check('commit details: subject', subject === 'Template strings', subject);
  check('commit details: body', (await page.evaluate(`document.querySelector('.commit-body')?.textContent`)) === 'Use a template literal and an explicit return type.');
  const files = await page.evaluate(`[...document.querySelectorAll('.commit-details .change-row')].map(r => r.textContent.trim()).join(' | ')`);
  check('commit details: files with status and counts', /Mapp\.ts\+2 −2/.test(files) && /RREADME\.md\+0 −0/.test(files) && /Alogo\.bin/.test(files) && !/logo\.bin\+/.test(files), files);

  await page.evaluate(`[...document.querySelectorAll('.commit-details .change-item')].find(b => b.textContent.includes('app.ts')).click()`);
  await page.waitFor(`document.querySelector('.monaco-diff-editor .editor.modified .view-lines')?.textContent.includes('Hello,')`);
  const original = await page.text('.monaco-diff-editor .editor.original .view-lines');
  const modified = await page.text('.monaco-diff-editor .editor.modified .view-lines');
  check('Monaco original side = parent version', original?.includes('return "Hello " + name;'), original);
  check('Monaco modified side = commit version', modified?.includes('return `Hello, ${name}!`;'), modified);
  const count = await page.waitFor(`document.querySelector('.diff-count')?.textContent`);
  check('changes counted', /\d+ changes?/.test(count ?? ''), count);
  check('syntax highlighting active', (await page.evaluate(`document.querySelectorAll('.monaco-diff-editor .editor.modified .view-lines span[class*="mtk"]').length`)) > 3);
  if (process.env.E2E_SCREENSHOTS) await page.screenshot(join(artifactsDir, 'diff-commit.png'));

  const layout = `document.querySelector('[aria-label="Diff layout"]')`;
  await page.selectOption(layout, 'inline');
  const inline = await page.waitFor(`!document.querySelector('.monaco-diff-editor').classList.contains('side-by-side')`, 2000);
  check('inline mode (no side-by-side layout)', inline === true, await page.evaluate(`document.querySelector('.monaco-diff-editor').className`));
  await page.selectOption(layout, 'split');

  await page.evaluate(`[...document.querySelectorAll('.commit-details .change-item')].find(b => b.textContent.includes('logo.bin')).click()`);
  const binaryMessage = await page.waitFor(`document.querySelector('.diff-message')?.textContent.startsWith('Binary') && document.querySelector('.diff-message').textContent`);
  check('binary file explained, not rendered', binaryMessage?.startsWith('Binary file'), binaryMessage);

  await page.evaluate(`document.querySelector('.close-details').click()`);
  await page.waitFor(`!!document.querySelector('.changes .change-item')`);
  await page.evaluate(`[...document.querySelectorAll('.changes .change-item')].find(b => b.textContent.includes('app.ts')).click()`);
  await page.waitFor(`document.querySelector('.diff-subtitle')?.textContent === 'Unstaged'`);
  await page.waitFor(`document.querySelector('.monaco-diff-editor .editor.modified .view-lines')?.textContent.includes('Hi,')`);
  const indexSide = await page.text('.monaco-diff-editor .editor.original .view-lines');
  check('working tree diff: index vs disk', indexSide?.includes('Hello, ${name}!'), indexSide);

  await page.press('Escape');
  check('Esc closes the diff', await page.waitFor(`!document.querySelector('.diff-view') && !!document.querySelector('.commits')`, 2000));
}
