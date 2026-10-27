// Preferences: open/close, diff options shared with the diff toolbar, custom external tools (global and per
// repository), validation, the Test button, commit identity, persistence across restarts, a damaged file.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, sleep, tempDir } from '../harness.mjs';

export const meta = { platforms: ['linux', 'darwin'] };

async function recorded(file) {
  for (let i = 0; i < 100 && !existsSync(file); i++) await sleep(50);
  return existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n') : null;
}

const row = (key) => `document.querySelector('.setting-row[data-setting="${key}"]')`;

export default async function ({ check }) {
  const work = tempDir('forklift-settings-');
  const bin = join(work, 'bin');
  mkdirSync(bin);
  const recorder = (out) => `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "${out}"\n`;
  writeFileSync(join(bin, 'alt-editor'), recorder(join(work, 'alt-editor.out')), { mode: 0o755 });
  writeFileSync(join(bin, 'repo-term'), recorder(join(work, 'repo-term.out')), { mode: 0o755 });
  writeFileSync(join(bin, 'fake-term'), recorder(join(work, 'fake-term.out')), { mode: 0o755 });

  const { root, git, write } = createRepo({ dir: join(work, 'repo') });
  write('a.txt', 'one\ntwo\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  write('a.txt', 'one\nTWO\n');

  const home = tempDir('forklift-home-');
  const env = { PATH: `${bin}:/usr/bin:/bin`, TERMINAL: 'fake-term' };
  let app = await launchApp({ home, env });
  let { page } = app;
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.change-row')`);

  // Open and close.
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  check('gear button opens Preferences', await page.waitFor(`!!document.querySelector('.preferences')`));
  check('Preferences opens on General by default', await page.waitFor(`document.querySelector('.preferences-content h2')?.textContent === 'General'`));
  await page.press('Escape');
  check('Esc closes Preferences', await page.waitFor(`!document.querySelector('.preferences') && !!document.querySelector('.change-row')`));
  await page.press(',', { code: 'Comma', keyCode: 188, modifiers: 2 });
  check('Ctrl+, opens Preferences', await page.waitFor(`!!document.querySelector('.preferences')`));
  check('shortcut also opens General by default', await page.waitFor(`document.querySelector('.preferences-content h2')?.textContent === 'General'`));

  // Diff layout set in Preferences is used by the diff view, and the toolbar toggle writes back.
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'Diff')`);
  await page.selectOption(`${row('diff.layout')}.querySelector('select')`, 'inline');
  await page.fill(`${row('diff.contextLines')}.querySelector('input')`, '99');
  await page.press('Enter');
  const rangeError = await page.waitFor(`${row('diff.contextLines')}.querySelector('.setting-error')?.textContent`);
  check('out-of-range number rejected next to the field', /from 0 to 50/.test(rangeError ?? ''), rangeError);
  await page.fill(`${row('diff.contextLines')}.querySelector('input')`, '5');
  await page.press('Enter');
  await page.waitFor(`!${row('diff.contextLines')}.querySelector('.setting-error')`);
  await page.click(`document.querySelector('[aria-label="Close preferences"]')`);
  await page.click(`[...document.querySelectorAll('.change-item')].find(b => b.textContent.includes('a.txt'))`);
  await page.waitFor(`!!document.querySelector('.monaco-diff-editor .editor.modified .view-lines')`);
  check('diff opens inline as set in Preferences', await page.waitFor(`!document.querySelector('.monaco-diff-editor').classList.contains('side-by-side')`, 3000));
  await page.selectOption(`document.querySelector('[aria-label="Diff layout"]')`, 'split');
  check('diff toolbar layout switches back to split', await page.waitFor(`document.querySelector('.monaco-diff-editor').classList.contains('side-by-side')`, 3000));
  await page.press('Escape');

  // A custom editor command for all repositories.
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'External tools')`);
  const editorSelect = `${row('tools.editor')}.querySelector('select')`;
  await page.waitFor(`[...${editorSelect}.options].some(o => o.value === 'preset:code')`);
  await page.selectOption(editorSelect, 'custom');
  await page.fill(`${row('tools.editor')}.querySelector('[id$="-command"]')`, 'does-not-exist');
  await page.fill(`${row('tools.editor')}.querySelector('[id$="-args"]')`, '--line {line} "{file}"');
  await page.click(`[...${row('tools.editor')}.querySelectorAll('button')].find(b => b.textContent === 'Apply')`);
  const missing = await page.waitFor(`${row('tools.editor')}.querySelector('.setting-error')?.textContent`);
  check('missing program rejected with an explanation', /"does-not-exist" was not found/.test(missing ?? ''), missing);
  await page.fill(`${row('tools.editor')}.querySelector('[id$="-command"]')`, 'alt-editor');
  await page.click(`[...${row('tools.editor')}.querySelectorAll('button')].find(b => b.textContent === 'Apply')`);
  // Test appears once the custom command is applied (it runs the saved choice).
  const testButton = `[...${row('tools.editor')}.querySelectorAll('button')].find(b => b.textContent === 'Test')`;
  await page.waitFor(`!!${testButton} && !${row('tools.editor')}.querySelector('.setting-error')`);
  await page.click(testButton);
  const tested = await page.waitFor(`${row('tools.editor')}.querySelector('.tool-status')?.textContent.startsWith('Opened') && ${row('tools.editor')}.querySelector('.tool-status').textContent`);
  check('Test opens a sample file in the chosen editor', /Opened .*example\.txt with .*alt-editor/.test(tested ?? ''), tested);
  const testArgs = await recorded(join(work, 'alt-editor.out'));
  check('Test passes the line and file as separate arguments', testArgs?.[1] === '--line' && testArgs[2] === '3' && /example\.txt$/.test(testArgs[3] ?? ''), JSON.stringify(testArgs));
  execFileSync('rm', ['-f', join(work, 'alt-editor.out')]);

  // A terminal only for this repository.
  await page.click(`[...document.querySelectorAll('.scope-switch button')].find(b => b.textContent.startsWith('This repository'))`);
  await page.waitFor(`!!${row('tools.terminal')} && !${row('git.executable')}`);
  check('repository scope shows only overridable settings', (await page.evaluate(`document.querySelectorAll('.setting-row[data-setting^="tools."]').length`)) === 4 && !(await page.evaluate(`!!${row('diff.layout')}`)));
  await page.selectOption(`${row('tools.terminal')}.querySelector('select')`, 'custom');
  await page.fill(`${row('tools.terminal')}.querySelector('[id$="-command"]')`, 'repo-term');
  await page.fill(`${row('tools.terminal')}.querySelector('[id$="-args"]')`, '--cd {dir}');
  await page.click(`[...${row('tools.terminal')}.querySelectorAll('button')].find(b => b.textContent === 'Apply')`);
  check('override marked in repository scope', await page.waitFor(`/Set for this repository/.test(${row('tools.terminal')}.textContent)`));
  await page.click(`document.querySelector('[aria-label="Close preferences"]')`);

  await page.evaluate(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Terminal').click()`);
  // The toolbar shows the embedded terminal; the external one opens from its header.
  await page.click(`document.querySelector('.terminal-dock:not([hidden]) [aria-label="Open external terminal"]')`);
  const term = await recorded(join(work, 'repo-term.out'));
  check('Terminal uses the repository override', JSON.stringify(term) === JSON.stringify([root, '--cd', root]), JSON.stringify(term));
  await page.evaluate(`[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('a.txt')).querySelector('[aria-label="Open in editor"]').click()`);
  const edit = await recorded(join(work, 'alt-editor.out'));
  check('Edit uses the global custom editor', JSON.stringify(edit) === JSON.stringify([root, '--line', '1', join(root, 'a.txt')]), JSON.stringify(edit));

  // Commit identity in global git config (HOME is the throwaway profile).
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.fill(`document.querySelector('.preferences-search')`, 'email');
  await page.waitFor(`!!${row('git.identity')}?.querySelector('[aria-label="Name"]')`);
  await page.fill(`${row('git.identity')}.querySelector('[aria-label="Name"]')`, 'Grace Hopper');
  await page.fill(`${row('git.identity')}.querySelector('[aria-label="Email"]')`, 'grace@example.com');
  await page.click(`[...${row('git.identity')}.querySelectorAll('button')].find(b => b.textContent === 'Save')`);
  await page.waitFor(`${row('git.identity')}.textContent.includes('Saved')`);
  const gitconfig = readFileSync(join(home, '.gitconfig'), 'utf8');
  check('identity written to the global git config', /name = Grace Hopper/.test(gitconfig) && /email = grace@example\.com/.test(gitconfig), gitconfig);
  await page.fill(`document.querySelector('.preferences-search')`, 'whitespace');
  check('search finds settings across sections', await page.waitFor(`document.querySelectorAll('.setting-row').length === 1 && !!${row('diff.ignoreWhitespace')}`));

  // Restart with the same profile: everything is still there.
  await app.close();
  app = await launchApp({ home, env });
  page = app.page;
  await page.invoke('repo:open', root);
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'Diff')`);
  const persisted = await page.waitFor(`${row('diff.contextLines')}?.querySelector('input').value`);
  check('settings survive a restart', persisted === '5', persisted);
  await page.press('Escape');
  const configDir = readdirSync(join(home, '.config')).find((name) => existsSync(join(home, '.config', name, 'settings.json')));
  const settingsFile = configDir && join(home, '.config', configDir, 'settings.json');
  const saved = settingsFile ? JSON.parse(readFileSync(settingsFile, 'utf8')) : null;
  check('settings saved to userData/settings.json', saved?.settings?.['diff.contextLines'] === 5 && saved?.settings?.['tools.editor']?.command === 'alt-editor' && saved?.repositories?.[root]?.['tools.terminal']?.command === 'repo-term', JSON.stringify(saved));
  execFileSync('rm', ['-f', join(work, 'repo-term.out')]);
  await page.evaluate(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Terminal').click()`);
  // The toolbar shows the embedded terminal; the external one opens from its header.
  await page.click(`document.querySelector('.terminal-dock:not([hidden]) [aria-label="Open external terminal"]')`);
  check('repository override still applies after restart', (await recorded(join(work, 'repo-term.out')))?.[1] === '--cd');

  // A damaged settings file: defaults, a visible explanation, the old file kept.
  await app.close();
  writeFileSync(settingsFile, '{ "version": 1, "settings": { broken');
  app = await launchApp({ home, env });
  page = app.page;
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  const problem = await page.waitFor(`document.querySelector('.settings-problems')?.textContent`);
  check('damaged file reported in Preferences', /settings file was damaged/.test(problem ?? ''), problem);
  check('damaged file kept aside', readdirSync(join(home, '.config', configDir)).some((name) => name.startsWith('settings.json.damaged-')));
  await page.click(`[...document.querySelectorAll('.settings-problems button')].find(b => b.textContent === 'Dismiss')`);
  check('problems can be dismissed', await page.waitFor(`!document.querySelector('.settings-problems')`));
}
