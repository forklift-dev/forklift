// Clone and Init from the Repositories screen: a clone over HTTP that asks for credentials in the app, a
// cancelled clone leaving nothing behind, a folder that is in the way, and a new repository with a
// .gitignore, a license and a first commit; each result opens in a tab.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startGitHttpServer } from '../gitHttp.mjs';
import { defer, GIT_IDENTITY, launchApp, tempDir } from '../harness.mjs';

const dialog = `document.querySelector('.new-repo-dialog')`;
const field = (name) => `${dialog}.querySelector('[name="${name}"]')`;
const button = (scope, label) => `[...${scope}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const promptText = `document.querySelector('.prompt-dialog .prompt-text')?.textContent`;
const top = `document.querySelector('.commit-row[data-hash] .subject')?.textContent`;

async function answer(page, kind, text) {
  const seen = await page.waitFor(`/${kind}/i.test(${promptText} ?? '') && ${promptText}`, 10000);
  await page.fill(`document.querySelector('.prompt-dialog input')`, text);
  await page.click(button(`document.querySelector('.prompt-dialog')`, 'Continue'));
  await page.waitFor(`!document.querySelector('.prompt-dialog') || ${promptText} !== ${JSON.stringify(seen)}`);
}

export default async function ({ check }) {
  const served = tempDir('forklift-served-');
  const env = { ...process.env, ...GIT_IDENTITY, GIT_TERMINAL_PROMPT: '0' };
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();
  sh(served, 'init', '-q', '--initial-branch=main', join(served, 'project'));
  writeFileSync(join(served, 'project', 'a.txt'), 'one\n');
  sh(join(served, 'project'), 'add', '.');
  sh(join(served, 'project'), 'commit', '-qm', 'First');
  sh(served, 'clone', '-q', '--bare', join(served, 'project'), join(served, 'project.git'));
  const http = await startGitHttpServer(served, { user: 'ada', password: 'lovelace' });
  defer(() => http.close());
  const url = `${http.url}/project.git`;

  const home = tempDir('forklift-home-');
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n');
  const work = tempDir('forklift-new-');
  const { page } = await launchApp({ home });
  // The setting picks the folder the dialogs start in.
  await page.invoke('settings:update', { values: { 'general.repositoriesFolder': work } });
  await page.waitFor(`!!document.querySelector('.repositories')`);

  // Clone over HTTP: the folder name follows the URL; credentials are asked in the app.
  await page.click(button(`document.querySelector('.repositories-header')`, 'Clone…'));
  await page.waitFor(`${field('parent')}?.value === ${JSON.stringify(work)}`);
  check('Clone starts in the folder from the settings', (await page.evaluate(`${field('parent')}.value`)) === work);
  check('Clone is disabled without a URL', await page.evaluate(`${button(dialog, 'Clone')}.disabled`));
  await page.fill(field('url'), url);
  check('folder name follows the URL', await page.waitFor(`${field('name')}.value === 'project'`));
  await page.waitFor(`!${button(dialog, 'Clone')}.disabled`);
  await page.click(button(dialog, 'Clone'));
  await answer(page, 'Username', 'ada');
  await answer(page, 'Password', 'lovelace');
  check('the clone opens in a tab', await page.waitFor(`!document.querySelector('.repositories') && ${top} === 'First'`, 15000));
  const cloned = join(work, 'project');
  check('cloned into the chosen folder with origin set', sh(cloned, 'remote', 'get-url', 'origin') === url && sh(cloned, 'log', '--format=%s') === 'First');

  // A folder with files is in the way.
  await page.click(`document.querySelector('[aria-label="Open a repository in a new tab"]')`);
  await page.click(button(`document.querySelector('.repositories-header')`, 'Clone…'));
  await page.waitFor(`${field('parent')}?.value === ${JSON.stringify(work)}`);
  await page.fill(field('url'), url);
  const inTheWay = await page.waitFor(`${dialog}.querySelector('.setting-error')?.textContent`);
  check('a non-empty folder is refused before cloning', /already exists and is not empty/.test(inTheWay ?? '') && (await page.evaluate(`${button(dialog, 'Clone')}.disabled`)), inTheWay);

  // Cancelled while git waits for credentials: nothing is left behind.
  await page.fill(field('name'), 'second');
  await page.waitFor(`!${button(dialog, 'Clone')}.disabled`);
  await page.click(button(dialog, 'Clone'));
  await page.waitFor(`/Username/.test(${promptText} ?? '')`, 10000);
  if (process.env.E2E_SHOTS) await page.screenshot(join(process.env.E2E_SHOTS, 'clone-prompt.png'));
  check('progress shows while cloning', await page.evaluate(`!!${dialog}.querySelector('.clone-progress')`));
  // The credential prompt covers the dialog; its Cancel clone button is what the user would reach after it.
  await page.evaluate(`${button(dialog, 'Cancel clone')}.click()`);
  const cancelled = await page.waitFor(`/cancelled/.test(${dialog}.querySelector('.setting-error')?.textContent ?? '') && ${dialog}.querySelector('.setting-error').textContent`, 10000);
  check('cancelling reports it in the dialog', /cancelled/.test(cancelled ?? ''), cancelled);
  check('the credential prompt goes away', await page.waitFor(`!document.querySelector('.prompt-dialog')`));
  check('a cancelled clone leaves no folder', !existsSync(join(work, 'second')));
  await page.click(button(dialog, 'Cancel'));
  check('Cancel closes the dialog', await page.waitFor(`!${dialog}`));

  // Init with templates and a first commit.
  mkdirSync(join(work, 'existing'));
  writeFileSync(join(work, 'existing', 'notes.txt'), 'mine\n');
  await page.click(button(`document.querySelector('.repositories-header')`, 'New…'));
  await page.waitFor(`${field('parent')}?.value === ${JSON.stringify(work)}`);
  await page.fill(field('name'), 'project');
  const repoProblem = await page.waitFor(`${dialog}.querySelector('.setting-error')?.textContent`);
  check('init refuses an existing repository', /already a git repository/.test(repoProblem ?? ''), repoProblem);
  await page.fill(field('name'), 'existing');
  await page.fill(field('branch'), 'trunk');
  await page.click(field('gitignore-node'));
  await page.click(field('gitignore-os'));
  await page.selectOption(field('license'), 'MIT');
  if (process.env.E2E_SHOTS) await page.screenshot(join(process.env.E2E_SHOTS, 'init-dialog.png'));
  check('license holder defaults to the git user name', await page.waitFor(`${field('holder')}?.value === 'Ada Lovelace'`));
  await page.waitFor(`!${button(dialog, 'Create')}.disabled`);
  await page.click(button(dialog, 'Create'));
  check('the new repository opens in a tab', await page.waitFor(`!document.querySelector('.repositories') && ${top} === 'Initial commit'`, 10000));
  const created = join(work, 'existing');
  check('first branch is the chosen one', sh(created, 'symbolic-ref', '--short', 'HEAD') === 'trunk');
  check('first commit holds only the starter files', sh(created, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort().join(',') === '.gitignore,LICENSE');
  check('.gitignore combines the chosen templates', /node_modules\//.test(readFileSync(join(created, '.gitignore'), 'utf8')) && /\.DS_Store/.test(readFileSync(join(created, '.gitignore'), 'utf8')));
  check('LICENSE names the holder', readFileSync(join(created, 'LICENSE'), 'utf8').includes(`Copyright (c) ${new Date().getFullYear()} Ada Lovelace`));
  check('files already in the folder stay uncommitted', await page.waitFor(`[...document.querySelectorAll('.change-row')].some(r => r.textContent.includes('notes.txt'))`));
}
