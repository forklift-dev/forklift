// Themes: every built-in app theme applied at once (CSS variables, graph, editor, terminal), a separate editor
// theme, "System", a user theme file picked up and re-read when it changes, a broken file explained, and a
// screenshot of each theme in tests/e2e/artifacts/themes.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, projectDir, tempDir } from '../harness.mjs';

export const meta = { platforms: ['linux', 'darwin'] };

const BUILTIN = ['forklift-dark', 'forklift-light', 'dark-high-contrast', 'light-high-contrast', 'polar', 'sand'];
const cssVar = (name, scope = 'document.documentElement') => `getComputedStyle(${scope}).getPropertyValue('--${name}').trim()`;
const option = (setting, id) => `document.querySelector('.setting-row[data-setting="${setting}"] [data-theme-id="${id}"]')`;

export default async function ({ check }) {
  const { root, git, write } = createRepo({ dir: join(tempDir('forklift-themes-'), 'repo') });
  for (let i = 0; i < 6; i++) {
    write(`f${i}.txt`, `line ${i}\n`.repeat(i + 1));
    git('add', '.');
    git('commit', '-qm', `Commit ${i}`);
    if (i === 2) git('checkout', '-qb', 'side');
    if (i === 4) git('checkout', '-q', 'main');
  }
  git('merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
  write('a.txt', 'changed\nline\n');

  const home = tempDir('forklift-home-');
  const shots = join(projectDir, 'tests/e2e/artifacts/themes');
  mkdirSync(shots, { recursive: true });
  const { page } = await launchApp({ home });
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.commit-row[data-hash]')`);

  check('"System" theme by default', (await page.evaluate(`document.documentElement.dataset.theme`)) === 'forklift-light' || (await page.evaluate(`document.documentElement.dataset.theme`)) === 'forklift-dark');

  // Each theme on the graph and on a diff; every one paints the app, the graph and the editor its own way.
  const looks = [];
  const graphLooks = [];
  for (const id of BUILTIN) {
    await page.invoke('settings:update', { values: { 'ui.theme': id } });
    await page.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(id)}`);
    graphLooks.push(await page.evaluate(`[getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.toolbar')).backgroundColor, getComputedStyle(document.querySelector('.graph-cell .edge, .graph-cell .node')).stroke].join('|')`));
    await page.screenshot(join(shots, `${id}-graph.png`));
  }
  await page.click(`[...document.querySelectorAll('.change-item')].find(b => b.textContent.includes('a.txt'))`);
  await page.waitFor(`!!document.querySelector('.monaco-diff-editor .editor.modified .view-lines')`);
  for (const id of BUILTIN) {
    await page.invoke('settings:update', { values: { 'ui.theme': id } });
    await page.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(id)}`);
    await page.waitFor(`getComputedStyle(document.querySelector('.monaco-editor-background')).backgroundColor !== ${JSON.stringify(looks.at(-1) ?? '')}`, 2000);
    looks.push(await page.evaluate(`getComputedStyle(document.querySelector('.monaco-editor-background')).backgroundColor`));
    await page.screenshot(join(shots, `${id}-diff.png`));
  }
  check('each theme paints the app and the graph its own way', new Set(graphLooks).size === BUILTIN.length, graphLooks.join('\n'));
  check('the editor follows the app theme', new Set(looks).size >= 4, looks.join(', '));

  // Picking in Preferences applies at once; the editor can have its own theme.
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'UI')`);
  await page.click(option('ui.theme', 'forklift-light'));
  check('clicking a theme card applies it', await page.waitFor(`document.documentElement.dataset.theme === 'forklift-light' && ${cssVar('bg')} === '#ffffff'`));
  check('the chosen card is marked', await page.evaluate(`${option('ui.theme', 'forklift-light')}.getAttribute('aria-checked') === 'true'`));
  await page.click(option('ui.editorTheme', 'dark-high-contrast'));
  check('editor theme applies separately', await page.waitFor(`document.documentElement.dataset.editorTheme === 'dark-high-contrast'`));
  check('editor decorations use the editor theme', (await page.evaluate(cssVar('code-bg', `document.querySelector('.monaco-editor')`))) === '#000000' && (await page.evaluate(cssVar('bg'))) === '#ffffff');
  check('Monaco paints with the editor theme', (await page.evaluate(`getComputedStyle(document.querySelector('.monaco-editor-background')).backgroundColor`)) === 'rgb(0, 0, 0)');
  await page.click(option('ui.editorTheme', 'app'));
  await page.waitFor(`document.documentElement.dataset.editorTheme === 'forklift-light'`);

  // A user theme file: picked up, applied, re-read when edited.
  const themes = await page.evaluate(`document.querySelector('.user-themes') && true`);
  check('themes folder note shown', themes === true);
  // userData/themes exists from the start, so users can find it.
  const configDir = readdirSync(join(home, '.config')).find((name) => existsSync(join(home, '.config', name, 'themes')));
  const actualFolder = join(home, '.config', configDir ?? 'missing', 'themes');
  check('themes folder created in userData', Boolean(configDir), readdirSync(join(home, '.config')).join(','));
  writeFileSync(join(actualFolder, 'ember.jsonc'), '// my theme\n{ "meta": { "name": "Ember", "extends": "forklift-dark" }, "tokens": { "accent": "#ff6a00", "bg": "#201510", }, }\n');
  check('a new theme file appears in the picker', await page.waitFor(`!!${option('ui.theme', 'user:ember')}`, 5000));
  await page.click(option('ui.theme', 'user:ember'));
  check('the user theme applies', await page.waitFor(`${cssVar('bg')} === '#201510' && ${cssVar('accent')} === '#ff6a00'`));
  check('unchanged tokens come from the theme it extends', (await page.evaluate(cssVar('fg'))) === '#e3e7ee');
  writeFileSync(join(actualFolder, 'ember.jsonc'), '{ "meta": { "name": "Ember", "extends": "forklift-dark" }, "tokens": { "accent": "#ff6a00", "bg": "#2a1a12" } }\n');
  check('editing the file re-applies it', await page.waitFor(`${cssVar('bg')} === '#2a1a12'`, 5000));
  await page.screenshot(join(shots, 'user-ember.png'));
  writeFileSync(join(actualFolder, 'broken.jsonc'), '{ "meta": { "name": "Broken" }, "tokens": { "bogus": "#fff" } }');
  const problem = await page.waitFor(`document.querySelector('.theme-problems')?.textContent`, 5000);
  check('a broken file is explained', /broken\.jsonc.*Unknown token "bogus"/.test(problem ?? ''), problem);
  await page.screenshot(join(shots, 'preferences-ui.png'));

  // The embedded terminal follows the theme.
  await page.press('Escape');
  await page.evaluate(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Terminal').click()`);
  await page.waitFor(`!!document.querySelector('.terminal-dock:not([hidden]) .xterm')`);
  const terminalBg = `getComputedStyle(document.querySelector('.terminal-dock .xterm-scrollable-element')).backgroundColor`;
  const before = await page.evaluate(terminalBg);
  await page.invoke('settings:update', { values: { 'ui.theme': 'sand' } });
  const after = await page.waitFor(`${terminalBg} !== ${JSON.stringify(before)} && ${terminalBg}`, 5000);
  check('the terminal repaints with the theme', after === 'rgb(250, 246, 238)', `${before} → ${after}`);
}
