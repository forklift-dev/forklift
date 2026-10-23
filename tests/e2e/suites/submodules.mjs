// Submodules: add one from the left panel, its change in the changes panel with a git-style diff, discard
// back to the recorded commit, a clone with submodules, initializing those of a plain clone, opening one
// in a tab, and removing it.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, GIT_IDENTITY, launchApp, tempDir } from '../harness.mjs';

const menuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === ${JSON.stringify(label)})`;
const submoduleRow = (path) => `document.querySelector('.ref-item[data-submodule=${JSON.stringify(path)}]')`;
async function contextMenu(page, expression) {
  await page.evaluate(`(() => { const el = ${expression}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 8 })); })()`);
  await page.waitFor(`!!document.querySelector('.context-menu')`);
}

// git 2.38.1+ refuses local paths as submodule URLs unless allowed; the test repositories are local.
const allowFile = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always' };

export default async function ({ check }) {
  const work = tempDir('forklift-submodules-');
  const env = { ...process.env, ...GIT_IDENTITY, ...allowFile };
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();
  const lib = join(work, 'lib');
  sh(work, 'init', '-q', '--initial-branch=main', lib);
  writeFileSync(join(lib, 'lib.txt'), 'lib\n');
  sh(lib, 'add', '.');
  sh(lib, 'commit', '-qm', 'lib');
  const { root, git, write } = createRepo({ dir: join(work, 'app') });
  write('a.txt', 'a\n');
  git('add', '.');
  git('commit', '-qm', 'app');

  const { page } = await launchApp({ env: allowFile });
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('[aria-label="Submodules"]')`);

  // Add.
  await page.click(`document.querySelector('[aria-label="Add a submodule"]')`);
  await page.fill(`document.querySelector('.form-dialog [name="url"]')`, lib);
  await page.fill(`document.querySelector('.form-dialog [name="path"]')`, 'libs/lib');
  await page.waitFor(`![...document.querySelectorAll('.form-dialog button')].find(b => b.textContent === 'Add').disabled`);
  await page.click(`[...document.querySelectorAll('.form-dialog button')].find(b => b.textContent === 'Add')`);
  check('the submodule is listed', await page.waitFor(`!!${submoduleRow('libs/lib')}`, 10000));
  check('it is staged with .gitmodules, marked as a submodule', await page.waitFor(`[...document.querySelectorAll('.change-row')].some(r => r.textContent.includes('libs/lib') && !!r.querySelector('.codicon-file-submodule')) && [...document.querySelectorAll('.change-row')].some(r => r.textContent.includes('.gitmodules'))`));
  await page.invoke('commit:create', root, 'Add lib\n', false);
  await page.waitFor(`document.querySelector('.commit-row[data-hash] .subject')?.textContent === 'Add lib'`);

  // New commits inside: a submodule change with a git-style diff.
  const inside = join(root, 'libs', 'lib');
  const recorded = sh(inside, 'rev-parse', 'HEAD');
  writeFileSync(join(inside, 'more.txt'), 'more\n');
  sh(inside, 'add', '.');
  sh(inside, 'commit', '-qm', 'more');
  const moved = sh(inside, 'rev-parse', 'HEAD');
  check('the left panel shows it at another commit', await page.waitFor(`/at another commit/.test(${submoduleRow('libs/lib')}?.textContent ?? '')`, 10000));
  await page.click(`[...document.querySelectorAll('.change-item')].find(b => b.textContent.includes('libs/lib'))`);
  const diff = await page.waitFor(`document.querySelector('.monaco-diff-editor .editor.modified .view-lines')?.textContent`, 5000);
  check('its diff shows the recorded and the checked-out commit', (diff ?? '').replace(/\s/g, '').includes(`Subprojectcommit${moved}`), diff);
  await page.press('Escape');
  await page.invoke('index:discard', root, ['libs/lib']);
  check('discarding checks out the recorded commit again', (await page.waitFor(`!/at another commit/.test(${submoduleRow('libs/lib')}?.textContent ?? 'x')`, 10000)) && sh(inside, 'rev-parse', 'HEAD') === recorded);

  // Clone with submodules (the default).
  await page.click(`document.querySelector('[aria-label="Open a repository in a new tab"]')`);
  await page.click(`[...document.querySelectorAll('.repositories-header button')].find(b => b.textContent === 'Clone…')`);
  await page.waitFor(`!!document.querySelector('.new-repo-dialog [name="parent"]')?.value`);
  await page.fill(`document.querySelector('.new-repo-dialog [name="url"]')`, root);
  await page.fill(`document.querySelector('.new-repo-dialog [name="parent"]')`, work);
  await page.fill(`document.querySelector('.new-repo-dialog [name="name"]')`, 'cloned');
  check('"Clone submodules too" is on', await page.evaluate(`document.querySelector('.new-repo-dialog [name="recurseSubmodules"]').checked`));
  await page.waitFor(`![...document.querySelectorAll('.new-repo-dialog button')].find(b => b.textContent === 'Clone').disabled`);
  await page.click(`[...document.querySelectorAll('.new-repo-dialog button')].find(b => b.textContent === 'Clone')`);
  await page.waitFor(`!document.querySelector('.repositories') && !!${submoduleRow('libs/lib')}`, 15000);
  check('the clone has its submodule checked out', existsSync(join(work, 'cloned', 'libs', 'lib', 'lib.txt')));

  // A plain clone: initialize from the left panel.
  const plain = join(work, 'plain');
  sh(work, 'clone', '-q', root, plain);
  await page.invoke('repo:open', plain);
  check('an uninitialized submodule says so', await page.waitFor(`/not initialized/.test(${submoduleRow('libs/lib')}?.textContent ?? '') && document.querySelector('.toolbar-repo')?.textContent.includes('plain')`, 10000));
  await contextMenu(page, submoduleRow('libs/lib'));
  await page.click(menuItem('Initialize and update'));
  check('Initialize and update clones it', await page.waitFor(`!!${submoduleRow('libs/lib')} && !/not initialized/.test(${submoduleRow('libs/lib')}.textContent)`, 15000) && existsSync(join(plain, 'libs', 'lib', 'lib.txt')));

  // Open in a tab.
  await page.evaluate(`${submoduleRow('libs/lib')}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  check('double-click opens the submodule in a tab', await page.waitFor(`[...document.querySelectorAll('.tab-bar [role="tab"], .tab-bar .tab')].some(t => t.textContent.trim().startsWith('lib'))`, 10000));
  await page.invoke('repo:activate', plain);

  // Remove.
  await page.waitFor(`!!${submoduleRow('libs/lib')}`);
  await contextMenu(page, submoduleRow('libs/lib'));
  await page.click(menuItem('Remove submodule…'));
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Remove')`);
  check('removing it deletes the folder and stages the removal', (await page.waitFor(`!${submoduleRow('libs/lib')}`, 10000)) && !existsSync(join(plain, 'libs', 'lib')) && sh(plain, 'status', '--porcelain').includes('D  libs/lib'));
}
