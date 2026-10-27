// The interface in Russian: with a Russian system language every screen is Russian (no English left in the app's
// own text), long Russian labels do not overflow, and switching the language in Preferences applies at once.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, projectDir, tempDir } from '../harness.mjs';

/** Latin words that stay as they are in the Russian interface: git commands and terms, names, keys, units. */
const ALLOWED = new Set(
  `Push Pull Fetch Rebase Cherry-pick Revert Reset Stash Pop Apply Amend Bisect Blame Checkout Skip Merge
   push pull fetch rebase cherry-pick revert reset stash pop merge amend checkout mixed soft hard squash fixup reword drop pick exec
   git Git HEAD WIP SHA URL LFS Gitflow feature release hotfix develop production upstream origin main detached worktree diff
   pull request requests merge issue issues Issues draft Forklift GitHub GitLab Forgejo Gitea GitVerse Gravatar Kraken Classic Compact Metro Polar Sand
   Ctrl Cmd Shift Alt Esc Enter Tab Meta Mod PATH TERMINAL UTF CLI SSH HTTPS http https ssh JSON KB MB ms API OK
   Meld KDiff Beyond Compare VS Code Vim Neovim Emacs Sublime Text Zed kitty Alacritty WezTerm foot XTerm Windows Terminal GNOME Konsole Ollama OpenAI Open Codex Claude OpenCode Qwen
   English Ada gitignore gitmodules commit-graph no-verify stderr stdout id email Email Worktree Diff
   blame config CSS JetBrains Mono monospace PowerShell cmd difftool mergetool ssh-agent`.split(/\s+/),
);

/** The app's own text in view: element text and labelling attributes, without the user's data (refs, paths, messages). */
const VISIBLE_TEXT = `(() => {
  const data = '.subject, .author-name, .ref, .ref-name, .change-path, .change-item .path, .change-name, .change-item .file, .crumb-value, .repo-path, .repo-open strong, .branch, .hash, .sha, .cell.sha, .cell.author, .cell.date, .monaco-editor, .xterm, .log-title, .log-repo, .tab-name, .prompt-text, .commit-identity';
  const out = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!element || element.closest(data) || element.closest('[hidden], script, style')) continue;
    if (!element.getClientRects().length) continue;
    const text = node.textContent.trim();
    if (text) out.add(text);
  }
  for (const element of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
    if (element.closest(data) || !element.getClientRects().length) continue;
    for (const name of ['title', 'aria-label', 'placeholder']) {
      const value = element.getAttribute(name);
      if (value && !value.startsWith('/')) out.add(value);
    }
  }
  return [...out];
})()`;

/** Texts with a Latin word that is not in ALLOWED (paths, shortcuts and placeholders such as {x} are ignored). */
function english(texts) {
  return texts.filter((text) => {
    // Code-like tokens stay as they are: paths, file names, options, variables, config keys, JSON.
    const prose = text.replace(/https?:\S+|[\w.-]+@[\w.-]+|\{\w+\}|\S*[./$~"=_:{}\\]\S*|--\S+|[A-Z]{2,}/g, ' ');
    const words = prose.match(/[A-Za-z][A-Za-z-]*/g) ?? [];
    return words.some((word) => word.length > 1 && !ALLOWED.has(word) && !/^[A-Z]$/.test(word));
  });
}

/** Labels cut off or spilling out of their box (Russian is often longer than English). */
const OVERFLOWING = `(() => {
  const out = [];
  for (const element of document.querySelectorAll('.tool-caption, .preferences-nav button, .scope-switch button, .modal-actions button, .context-menu button, .history-bar button, .changes-header button, .commit-panel button')) {
    if (!element.getClientRects().length) continue;
    if (element.scrollWidth > element.clientWidth + 1) out.push(element.textContent.trim());
  }
  // Captions wider than their button, header labels running into the next column.
  for (const caption of document.querySelectorAll('.tool-caption')) {
    const own = caption.getBoundingClientRect(), button = caption.closest('button').getBoundingClientRect();
    if (own.left < button.left - 1 || own.right > button.right + 1) out.push(caption.textContent.trim());
  }
  for (const label of document.querySelectorAll('.commit-header .header-label')) {
    const own = label.getBoundingClientRect(), cell = label.parentElement.getBoundingClientRect();
    if (own.right > cell.right + 1) out.push(label.textContent.trim());
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('the window scrolls sideways');
  return out;
})()`;

export default async function ({ check }) {
  const work = tempDir('forklift-i18n-');
  const { root, git, write } = createRepo({ dir: join(work, 'проект') });
  write('заметки.txt', 'один\n');
  git('add', '.');
  git('commit', '-qm', 'Первый коммит');
  git('branch', 'черновик');
  git('tag', 'в1');
  write('заметки.txt', 'два\n');
  write('новый.txt', 'новый\n');

  const { page } = await launchApp({ lang: 'ru-RU', windowSize: '1280,800' });
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.change-item') && !!document.querySelector('.commit-row[data-hash] .subject')`);

  check('a Russian system shows the app in Russian', await page.waitFor(`document.documentElement.lang === 'ru' && !!document.querySelector('.tool-button[aria-label="Ветка"]')`));

  const screens = {};
  const look = async (name) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    screens[name] = { english: english(await page.evaluate(VISIBLE_TEXT)), overflow: await page.evaluate(OVERFLOWING) };
  };
  const closeOverlay = async () => {
    await page.press('Escape');
    await page.waitFor(`!document.querySelector('.palette') && !document.querySelector('.modal') && !document.querySelector('.context-menu')`);
  };

  await look('workspace');

  await page.evaluate(`(() => { const el = document.querySelector('.ref-item[data-ref="refs/heads/черновик"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 8 })); })()`);
  await page.waitFor(`!!document.querySelector('.context-menu')`);
  await look('branch menu');
  await closeOverlay();

  await page.evaluate(`(() => { const el = document.querySelector('.commit-row[data-hash]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 300, clientY: r.y + 8 })); })()`);
  await page.waitFor(`!!document.querySelector('.context-menu')`);
  await look('commit menu');
  await closeOverlay();

  await page.click(`document.querySelector('.tool-button[aria-label="Ветка"]')`);
  await page.waitFor(`!!document.querySelector('.modal')`);
  await look('new branch dialog');
  await closeOverlay();

  await page.press('P', { code: 'KeyP', keyCode: 80, modifiers: 2 | 8 });
  await page.waitFor(`!!document.querySelector('.palette')`);
  await look('command palette');
  await closeOverlay();

  await page.click(`document.querySelector('[aria-label="Журнал операций"]')`);
  await page.waitFor(`!!document.querySelector('.log-view, [aria-label="Журнал операций"] h1')`);
  await look('operation log');
  await page.press('Escape');

  await page.click(`document.querySelector('[aria-label="Настройки (Ctrl+,)"], [title="Настройки (Ctrl+,)"]')`);
  await page.waitFor(`!!document.querySelector('.preferences')`);
  const sections = await page.evaluate(`document.querySelectorAll('.preferences-nav button').length`);
  for (let i = 0; i < sections; i++) {
    await page.click(`document.querySelectorAll('.preferences-nav button')[${i}]`);
    await look(`preferences ${i + 1}`);
  }

  const problems = Object.entries(screens).filter(([, found]) => found.english.length || found.overflow.length);
  // The whole list, for fixing: the check's message is cut short.
  const artifacts = join(projectDir, 'tests/e2e/artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'i18n.json'), JSON.stringify(Object.fromEntries(problems), null, 1));
  check('no English left in the app’s own text, nothing overflows', problems.length === 0, JSON.stringify(Object.fromEntries(problems), null, 1));

  // Switching the language applies at once, in the open Preferences too.
  await page.invoke('settings:update', { values: { 'ui.language': 'en' } });
  check('switching to English applies without a restart', await page.waitFor(`document.documentElement.lang === 'en' && document.querySelector('.preferences h1')?.textContent === 'Preferences'`));
  await page.invoke('settings:update', { values: { 'ui.language': 'ru' } });
  check('and back to Russian', await page.waitFor(`document.querySelector('.preferences h1')?.textContent === 'Настройки'`));
}
