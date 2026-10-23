// Command palette (Ctrl+Shift+P), the finder (Ctrl+P: files, branches, tags, commits; "> " for commands) and
// changing shortcuts in Preferences: recording, conflicts, removing a default, reset, any keyboard layout.
import { join } from 'node:path';
import { createRepo, launchApp, tempDir } from '../harness.mjs';

const CTRL = 2;
const SHIFT = 8;
const ALT = 1;
const palette = `document.querySelector('.palette')`;
const items = `[...document.querySelectorAll('.palette-item')].map(i => i.textContent)`;
const activeItem = `document.querySelector('.palette-item.active')?.textContent`;

export default async function ({ check }) {
  const { root, git, write } = createRepo({ dir: join(tempDir('forklift-commands-'), 'repo') });
  write('README.md', 'hello\n');
  write('src/login/form.ts', 'export {};\n');
  git('add', '.');
  git('commit', '-qm', 'Initial layout');
  git('checkout', '-qb', 'feature/search');
  write('src/search.ts', 'export {};\n');
  git('add', '.');
  git('commit', '-qm', 'Fix login bug');
  git('tag', 'v1.0');
  git('checkout', '-q', 'main');
  write('README.md', 'hello again\n');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.commit-row[data-hash]')`);
  const key = (k, code, modifiers) => page.press(k, { code, keyCode: k.toUpperCase().charCodeAt(0), modifiers });

  // Command palette.
  await key('P', 'KeyP', CTRL | SHIFT);
  check('Ctrl+Shift+P opens the command palette', await page.waitFor(`!!${palette} && document.activeElement === document.querySelector('.palette-input')`));
  await page.insertText('open pref');
  const first = await page.waitFor(`${activeItem}?.includes('Open Preferences') && ${activeItem}`);
  if (process.env.E2E_SHOTS) await page.screenshot(join(process.env.E2E_SHOTS, 'palette.png'));
  check('commands are matched fuzzily and show their shortcut', /App: Open Preferences/.test(first ?? '') && /Ctrl\+,/.test(first ?? ''), first);
  await page.press('Enter');
  check('Enter runs the command', await page.waitFor(`!${palette} && !!document.querySelector('.preferences')`));
  await page.press('Escape');
  await page.waitFor(`!document.querySelector('.preferences')`);

  await key('P', 'KeyP', CTRL | SHIFT);
  await page.insertText('stash all');
  await page.waitFor(`${activeItem}?.includes('Stash all changes')`);
  await page.press('Enter');
  check('a repository command runs from the palette', await page.waitFor(`!!document.querySelector('.commit-row.stash')`, 5000));
  await key('P', 'KeyP', CTRL | SHIFT);
  await page.insertText('pop');
  await page.waitFor(`${activeItem}?.includes('Pop the latest stash')`);
  await page.press('Enter');
  await page.waitFor(`!document.querySelector('.commit-row.stash') && !document.querySelector('.toolbar .spinner')`, 5000);
  await key('P', 'KeyP', CTRL | SHIFT);
  await page.insertText('pop the latest');
  check('commands that cannot run now are not offered', await page.waitFor(`document.querySelectorAll('.palette-item').length === 0 && !!document.querySelector('.palette-empty')`));
  await page.press('Escape');
  check('Esc closes the palette', await page.waitFor(`!${palette}`));

  // Finder: files.
  await key('P', 'KeyP', CTRL);
  check('Ctrl+P opens the finder', await page.waitFor(`!!${palette} && document.querySelector('.palette-input').placeholder.startsWith('File, branch')`));
  check('changed files are offered first', await page.waitFor(`${items}.some(t => t.includes('README.md') && t.includes('changed'))`));
  await page.insertText('lgnfrm');
  check('files are found fuzzily', (await page.waitFor(`${activeItem}`))?.includes('src/login/form.ts'));
  await page.press('Enter');
  check('an unchanged file opens its history', await page.waitFor(`document.querySelector('.file-history')?.getAttribute('aria-label') === 'History of src/login/form.ts'`, 5000));
  await page.press('Escape');
  await key('P', 'KeyP', CTRL);
  await page.insertText('readme');
  await page.waitFor(`${activeItem}?.includes('README.md')`);
  await page.press('Enter');
  check('a changed file opens its diff', await page.waitFor(`!!document.querySelector('.monaco-diff-editor')`, 5000));
  await page.press('Escape');

  // Finder: branches, tags, commits.
  const featureSha = git('rev-parse', 'feature/search');
  await key('P', 'KeyP', CTRL);
  await page.insertText('ftsrch');
  await page.waitFor(`${activeItem}?.includes('feature/search')`);
  await page.press('Enter');
  check('a branch shows its commit', await page.waitFor(`document.querySelector('.commit-row.selected')?.dataset.hash === ${JSON.stringify(featureSha)}`, 5000));
  await key('P', 'KeyP', CTRL);
  await page.insertText('fx lgn');
  if (process.env.E2E_SHOTS) await page.screenshot(join(process.env.E2E_SHOTS, 'finder.png'));
  const commitItem = await page.waitFor(`[...document.querySelectorAll('.palette-item')].find(i => i.textContent.includes('Fix login bug'))?.textContent`, 5000);
  check('commits are found by their subject', /Fix login bug.*Ada/.test(commitItem ?? ''), commitItem);
  await page.press('Escape');
  await key('P', 'KeyP', CTRL);
  await page.insertText('v1');
  check('tags are offered', await page.waitFor(`${items}.some(t => t.includes('v1.0') && t.includes('tag'))`));
  await page.press('Escape');
  await key('P', 'KeyP', CTRL);
  await page.insertText('ftsrch');
  await page.waitFor(`${activeItem}?.includes('feature/search')`);
  await page.press('Enter', { modifiers: SHIFT });
  check('Shift+Enter checks out the branch', await page.waitFor(`document.querySelector('.toolbar .branch')?.textContent.includes('feature/search')`, 5000));
  await key('P', 'KeyP', CTRL);
  await page.insertText('>');
  check('">" switches to commands', await page.waitFor(`document.querySelector('.palette-input')?.placeholder === 'Type a command'`));
  await page.press('Escape');

  // Shortcuts work by physical key: Ctrl+P with a Cyrillic layout ("з").
  await page.press('з', { code: 'KeyP', keyCode: 80, modifiers: CTRL });
  check('shortcuts work with any keyboard layout', await page.waitFor(`!!${palette}`));
  await page.press('Escape');

  // Changing shortcuts.
  await key('P', 'KeyP', CTRL | SHIFT);
  await page.insertText('keyboard shortcuts');
  await page.waitFor(`${activeItem}?.includes('Keyboard shortcuts')`);
  await page.press('Enter');
  const row = (id) => `document.querySelector('.keybindings-table tr[data-command="${id}"]')`;
  check('the shortcut editor lists the commands', await page.waitFor(`!!${row('app.preferences')}`));
  await page.fill(`document.querySelector('.keybindings-filter')`, 'open preferences');
  await page.waitFor(`document.querySelectorAll('.keybindings-table tr').length === 1`);
  await page.click(`${row('app.preferences')}.querySelector('[aria-label^="Add a shortcut"]')`);
  await page.waitFor(`document.activeElement?.matches('[data-key-recorder]')`);
  await key('W', 'KeyW', CTRL);
  const conflict = await page.waitFor(`${row('app.preferences')}.querySelector('.setting-error')?.textContent`);
  check('a shortcut in use elsewhere is refused', /Ctrl\+W is already used by “Close tab”/.test(conflict ?? ''), conflict);
  check('recording did not run the other command', await page.evaluate(`!!document.querySelector('.preferences')`));
  await page.click(`${row('app.preferences')}.querySelector('[aria-label^="Add a shortcut"]')`);
  await page.waitFor(`document.activeElement?.matches('[data-key-recorder]')`);
  await key('K', 'KeyK', CTRL | ALT);
  if (process.env.E2E_SHOTS) {
    await page.fill(`document.querySelector('.keybindings-filter')`, '');
    await page.screenshot(join(process.env.E2E_SHOTS, 'keybindings.png'));
    await page.fill(`document.querySelector('.keybindings-filter')`, 'open preferences');
  }
  check('a recorded shortcut is added', await page.waitFor(`${row('app.preferences')}.textContent.includes('Ctrl+Alt+K') && ${row('app.preferences')}.textContent.includes('changed')`));
  await page.click(`${row('app.preferences')}.querySelector('[aria-label="Remove Ctrl+,"]')`);
  await page.waitFor(`!${row('app.preferences')}.textContent.includes('Ctrl+,')`);
  await page.press('Escape');
  await page.waitFor(`!document.querySelector('.preferences')`);
  await key('K', 'KeyK', CTRL | ALT);
  check('the new shortcut runs the command', await page.waitFor(`!!document.querySelector('.preferences')`));
  await page.press('Escape');
  await page.waitFor(`!document.querySelector('.preferences')`);
  await page.press(',', { code: 'Comma', keyCode: 188, modifiers: CTRL });
  check('a removed default no longer runs it', await page.evaluate(`new Promise(r => setTimeout(() => r(!document.querySelector('.preferences')), 300))`));
  await key('K', 'KeyK', CTRL | ALT);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'Keyboard shortcuts')`);
  await page.waitFor(`!!${row('app.preferences')}`);
  await page.fill(`document.querySelector('.keybindings-filter')`, 'open preferences');
  await page.click(`[...${row('app.preferences')}.querySelectorAll('button')].find(b => b.textContent === 'Reset')`);
  check('Reset restores the default', await page.waitFor(`${row('app.preferences')}.textContent.includes('Ctrl+,') && !${row('app.preferences')}.textContent.includes('Ctrl+Alt+K')`));
  await page.press('Escape');
  await page.waitFor(`!document.querySelector('.preferences')`);
  await page.press(',', { code: 'Comma', keyCode: 188, modifiers: CTRL });
  check('the default works again', await page.waitFor(`!!document.querySelector('.preferences')`));
}
