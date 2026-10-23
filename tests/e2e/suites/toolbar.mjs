// The GitKraken-like toolbar: repository ▾ / branch ▾ crumbs, the action buttons (caption above the icon),
// Actions and Search, and the log, Preferences and profile at the end of the tab row; a screenshot of the
// toolbar in every built-in theme goes to tests/e2e/artifacts/toolbar.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, projectDir, tempDir } from '../harness.mjs';

const THEMES = ['forklift-dark', 'forklift-light', 'dark-high-contrast', 'light-high-contrast', 'polar', 'sand'];
const crumb = (label) => `[...document.querySelectorAll('.toolbar .crumb')].find(c => c.querySelector('.crumb-label')?.textContent === ${JSON.stringify(label)})`;
const tool = (label) => `document.querySelector('.toolbar .tool-button[aria-label=${JSON.stringify(label)}]')`;
const menuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === ${JSON.stringify(label)})`;
const closeOverlay = async (page) => {
  await page.press('Escape');
  await page.waitFor(`!document.querySelector('.palette') && !document.querySelector('.modal') && !document.querySelector('.context-menu')`);
};

export default async function ({ check }) {
  const work = tempDir('forklift-toolbar-');
  const { root, git, write } = createRepo({ dir: join(work, 'shop') });
  write('a.txt', 'a\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  git('branch', 'feature/cart');
  write('a.txt', 'b\n');
  const other = createRepo({ dir: join(work, 'blog') });
  other.write('x.txt', 'x\n');
  other.git('add', '.');
  other.git('commit', '-qm', 'blog');

  const { page } = await launchApp();
  await page.invoke('repo:open', other.root);
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.commit-row[data-hash]')`);

  check('crumbs show the repository and the branch with their captions', await page.waitFor(`${crumb('repository')}?.textContent.includes('shop') && ${crumb('branch')}?.textContent.includes('main')`));
  const captions = await page.evaluate(`[...document.querySelectorAll('.toolbar .tool-button')].map(b => b.querySelector('.tool-caption').textContent).join(',')`);
  check('action buttons in GitKraken order, caption above the icon', captions === 'Undo,Redo,Pull,Push,Branch,Stash,Pop,Terminal,Actions,Search', captions);
  check('the caption comes before the icon', await page.evaluate(`${tool('Push')}.firstElementChild.classList.contains('tool-caption') && ${tool('Push')}.lastElementChild.classList.contains('codicon')`));
  check('buttons without something to do are disabled', await page.evaluate(`${tool('Undo')}.disabled && ${tool('Pop')}.disabled && !${tool('Stash')}.disabled`));

  // repository ▾
  await page.click(crumb('repository'));
  const items = await page.waitFor(`[...document.querySelectorAll('.context-menu button')].map(b => b.textContent).join('|')`);
  check('the repository menu has recent repositories and repository actions', /^blog\|/.test(items ?? '') && /Open a repository…\|Clone a repository…\|Create a repository…\|Refresh\|Close tab/.test(items ?? ''), items);
  await page.click(menuItem('Clone a repository…'));
  check('…Clone opens the clone dialog', await page.waitFor(`document.querySelector('.new-repo-dialog')?.dataset.kind === 'clone'`));
  await closeOverlay(page);
  await page.evaluate(`document.querySelector('.close-repositories')?.click()`);
  await page.waitFor(`!document.querySelector('.repositories')`);
  await page.click(crumb('repository'));
  await page.click(menuItem('blog'));
  check('…a recent repository opens in its tab', await page.waitFor(`${crumb('repository')}?.textContent.includes('blog')`));
  await page.invoke('repo:activate', root);
  await page.waitFor(`${crumb('repository')}?.textContent.includes('shop')`);

  // branch ▾
  await page.click(crumb('branch'));
  check('the branch crumb opens the branch switcher', await page.waitFor(`document.querySelector('.palette-input')?.placeholder === 'Switch to branch'`));
  await page.insertText('cart');
  await page.waitFor(`document.querySelector('.palette-item.active')?.textContent.includes('feature/cart')`);
  await page.press('Enter');
  check('…and checks out the chosen branch', await page.waitFor(`document.querySelector('.toolbar .branch')?.firstChild?.textContent === 'feature/cart'`, 5000));

  await page.click(tool('Branch'));
  check('Branch creates a branch at HEAD', await page.waitFor(`/Create branch/i.test(document.querySelector('.form-dialog h2')?.textContent ?? '')`));
  await closeOverlay(page);
  await page.click(tool('Actions'));
  check('Actions opens the command palette', await page.waitFor(`document.querySelector('.palette-input')?.placeholder === 'Type a command'`));
  await closeOverlay(page);
  await page.click(tool('Search'));
  check('Search opens the finder', await page.waitFor(`document.querySelector('.palette-input')?.placeholder.startsWith('File, branch')`));
  await closeOverlay(page);

  // The end of the tab row.
  await page.click(`document.querySelector('.tab-bar-end [aria-label="Operation log"]')`);
  check('the bell opens the operation log', await page.waitFor(`!!document.querySelector('.log-view')`));
  await page.press('Escape');
  await page.click(`document.querySelector('.tab-bar-end .profile-button')`);
  check('the profile button opens the profile switcher', await page.waitFor(`document.querySelector('.palette-input')?.placeholder === 'Switch profile'`));
  await closeOverlay(page);

  const shots = join(projectDir, 'tests/e2e/artifacts/toolbar');
  mkdirSync(shots, { recursive: true });
  for (const theme of THEMES) {
    await page.invoke('settings:update', { values: { 'ui.theme': theme } });
    await page.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`);
    await page.screenshot(join(shots, `${theme}.png`));
  }
  check('toolbar screenshots saved for every theme', true);
}
