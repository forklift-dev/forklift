// Gitflow through the UI: set up, then a feature, a release and a hotfix from start to finish (merges, tags,
// branches deleted), started from the Gitflow section and the command palette.
import { join } from 'node:path';
import { createRepo, launchApp, tempDir } from '../harness.mjs';

const CTRL = 2;
const SHIFT = 8;
const menuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === ${JSON.stringify(label)})`;
const dialogButton = (label) => `[...document.querySelectorAll('.form-dialog button')].find(b => b.textContent === ${JSON.stringify(label)})`;
const flowRow = (branch) => `document.querySelector('.ref-item[data-flow=${JSON.stringify(branch)}]')`;
const head = `document.querySelector('.toolbar .branch')?.textContent`;
async function contextMenu(page, expression) {
  await page.evaluate(`(() => { const el = ${expression}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 8 })); })()`);
  await page.waitFor(`!!document.querySelector('.context-menu')`);
}

export default async function ({ check }) {
  const { root, git, write } = createRepo({ dir: join(tempDir('forklift-gitflow-'), 'repo') });
  write('a.txt', 'a\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  const commitFile = async (file, message) => {
    write(file, `${message}\n`);
    await page.invoke('index:stage', root, [file]);
    await page.invoke('commit:create', root, `${message}\n`, false);
  };
  const palette = async (text, title) => {
    await page.press('P', { code: 'KeyP', keyCode: 80, modifiers: CTRL | SHIFT });
    await page.insertText(text);
    await page.waitFor(`document.querySelector('.palette-item.active')?.textContent.includes(${JSON.stringify(title)})`);
    await page.press('Enter');
  };
  const submit = async (label) => {
    await page.waitFor(`!!${dialogButton(label)} && !${dialogButton(label)}.disabled`);
    await page.click(dialogButton(label));
    await page.waitFor(`!document.querySelector('.form-dialog')`, 10000);
  };

  // Set up.
  await page.waitFor(`!!document.querySelector('.gitflow-setup button')`, 5000);
  await page.click(`document.querySelector('.gitflow-setup button')`);
  check('setup proposes main and develop', await page.waitFor(`document.querySelector('.form-dialog [name="production"]')?.value === 'main' && document.querySelector('.form-dialog [name="develop"]').value === 'develop'`));
  await page.fill(`document.querySelector('.form-dialog [name="versionTag"]')`, 'v');
  await submit('Save');
  check('setup writes git config and creates develop', git('config', 'gitflow.branch.develop') === 'develop' && git('rev-parse', 'develop') === git('rev-parse', 'main') && (await page.waitFor(`!document.querySelector('.gitflow-setup')`)));

  // Feature from the section.
  await page.click(`document.querySelector('[aria-label="Start a feature, release or hotfix"]')`);
  await page.click(menuItem('Start a feature…'));
  await page.fill(`document.querySelector('.form-dialog [name="name"]')`, 'login');
  await submit('Start');
  check('a feature starts on its branch', await page.waitFor(`${head} === 'feature/login' && !!${flowRow('feature/login')}`, 5000));
  await commitFile('login.txt', 'Login form');
  await contextMenu(page, flowRow('feature/login'));
  await page.click(menuItem('Finish feature login…'));
  await submit('Finish');
  check('finishing merges it into develop and deletes it', (await page.waitFor(`${head} === 'develop' && !${flowRow('feature/login')}`, 10000)) && git('log', '-1', '--format=%s', 'develop') === "Merge branch 'feature/login' into develop" && !git('branch', '--list', 'feature/login'));

  // Release from the palette.
  await palette('start a release', 'Start a release');
  await page.fill(`document.querySelector('.form-dialog [name="name"]')`, '1.0');
  await submit('Start');
  await page.waitFor(`${head} === 'release/1.0'`, 5000);
  await commitFile('version.txt', 'Version 1.0');
  await palette('finish the current', 'Finish the current');
  check('the release dialog proposes a tag message', await page.waitFor(`document.querySelector('.form-dialog [name="tagMessage"]')?.value === 'Release 1.0'`));
  await submit('Finish');
  await page.waitFor(`${head} === 'develop' && !${flowRow('release/1.0')}`, 10000);
  check('a finished release is tagged on main and merged back', git('tag', '--list', 'v1.0') === 'v1.0' && git('rev-parse', 'v1.0^{commit}') === git('rev-parse', 'main') && git('merge-base', '--is-ancestor', 'main', 'develop') === '');

  // Hotfix.
  await page.click(`document.querySelector('[aria-label="Start a feature, release or hotfix"]')`);
  await page.click(menuItem('Start a hotfix…'));
  await page.fill(`document.querySelector('.form-dialog [name="name"]')`, '1.0.1');
  await submit('Start');
  check('a hotfix starts from main', await page.waitFor(`${head} === 'hotfix/1.0.1'`, 5000) && git('rev-parse', 'HEAD') === git('rev-parse', 'main'));
  await commitFile('fix.txt', 'Urgent fix');
  await contextMenu(page, flowRow('hotfix/1.0.1'));
  await page.click(menuItem('Finish hotfix 1.0.1…'));
  await submit('Finish');
  await page.waitFor(`${head} === 'develop' && !${flowRow('hotfix/1.0.1')}`, 10000);
  check('a finished hotfix is tagged and in both branches', git('tag', '--list', 'v1.0.1') === 'v1.0.1' && git('merge-base', '--is-ancestor', 'v1.0.1', 'develop') === '' && git('log', '-1', '--format=%s', 'develop') === "Merge tag 'v1.0.1' into develop");
}
