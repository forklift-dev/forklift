// GitVerse integration against the mock server in its GitVerse flavor (API under /api, Bearer tokens, the API
// version in Accept, issue lists with pull requests in them, no refs/pull/N/head): adding a GitVerse account,
// pull requests and issues, and checking out a fork's pull request from the fork's branch itself.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startForgejoMock } from '../forgejoMock.mjs';
import { binary, defer, GIT_IDENTITY, launchApp, tempDir } from '../harness.mjs';

const button = (scope, label) => `[...${scope}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const item = (id) => `document.querySelector('[data-hosting="${id}"]')`;
const view = `document.querySelector('.hosting-view')`;
const viewText = `(${view}?.textContent ?? '')`;
const accounts = `document.querySelector('.hosting-accounts')`;

export default async function ({ check }) {
  if (binary) return; // FORKLIFT_TEST_BASIC_SECRETS works in development builds only.
  const env = { ...process.env, ...GIT_IDENTITY, GIT_TERMINAL_PROMPT: '0' };
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();

  // ada/demo with a feature branch, and eve's fork eve/demo with the fix branch (no refs/pull on this server).
  const served = tempDir('forklift-gitverse-');
  const seed = join(served, 'seed');
  sh(served, 'init', '-q', '--initial-branch=main', seed);
  writeFileSync(join(seed, 'a.txt'), 'one\n');
  sh(seed, 'add', '.');
  sh(seed, 'commit', '-qm', 'First');
  sh(seed, 'branch', 'feature');
  sh(served, 'clone', '-q', '--bare', seed, join(served, 'ada', 'demo.git'));
  sh(seed, 'checkout', '-qb', 'fix');
  writeFileSync(join(seed, 'fix.txt'), 'fix\n');
  sh(seed, 'add', '.');
  sh(seed, 'commit', '-qm', 'Fix from a fork');
  const forkSha = sh(seed, 'rev-parse', 'HEAD');
  sh(served, 'clone', '-q', '--bare', seed, join(served, 'eve', 'demo.git'));
  const mock = await startForgejoMock({ gitRoot: served, flavor: 'gitverse' });
  defer(() => mock.close());
  const root = join(tempDir('forklift-mine-'), 'demo');
  sh(served, 'clone', '-q', join(served, 'ada', 'demo.git'), root);
  sh(root, 'remote', 'set-url', 'origin', `${mock.url}/ada/demo.git`);

  const { page } = await launchApp({ env: { FORKLIFT_TEST_BASIC_SECRETS: '1' } });
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'Integrations')`);
  await page.waitFor(`!!${button(accounts, 'Add an account…')} && !${button(accounts, 'Add an account…')}.disabled`);
  await page.click(button(accounts, 'Add an account…'));
  await page.selectOption(`document.querySelector('.account-form [name="provider"]')`, 'gitverse');
  check('GitVerse fills in its server', await page.waitFor(`document.querySelector('.account-form [name="url"]').value === 'https://gitverse.ru'`));
  check('the form says where to create the token', /gitverse\.ru\/settings\/tokens/.test(await page.evaluate(`document.querySelector('.account-form').textContent`)));
  await page.fill(`document.querySelector('.account-form [name="url"]')`, mock.url);
  await page.fill(`document.querySelector('.account-form [name="token"]')`, 'tok-ada');
  await page.click(button(`document.querySelector('.account-form')`, 'Add account'));
  const added = await page.waitFor(`document.querySelector('.hosting-accounts [data-account]')?.textContent`, 8000);
  check('the GitVerse account is added', /GitVerse/.test(added ?? '') && /ada/.test(added ?? ''), added);
  check('API requests use Bearer and the API version', mock.requests.length > 0 && mock.requests.filter((r) => !r.git).every((r) => r.authorized && r.accept === 'application/vnd.gitverse.object+json;version=1'));
  await page.press('Escape');
  await page.waitFor(`!document.querySelector('.preferences')`);

  await page.invoke('repo:open', root);
  check('pull requests are listed', await page.waitFor(`!!${item('pull-1')} && !!${item('pull-2')}`, 10000));
  check('issues are listed without the pull requests', await page.waitFor(`!!${item('issue-3')}`) && !(await page.evaluate(`!!${item('issue-1')} || !!${item('issue-2')}`)));
  await page.click(item('pull-2'));
  await page.waitFor(`/WIP: Fix from a fork/.test(${viewText}) && !!${button(view, 'Check out')}`);
  await page.click(button(view, 'Check out'));
  check('a fork’s pull request is fetched from the fork’s branch as pr/2', await page.waitFor(`document.querySelector('.toolbar .branch')?.textContent.startsWith('pr/2')`, 15000) && sh(root, 'rev-parse', 'pr/2') === forkSha);
  check('git used the token, nobody was asked', !(await page.evaluate(`!!document.querySelector('.prompt-dialog')`)) && mock.requests.some((r) => r.git && r.path.startsWith('/eve/demo.git') && r.authorized));
}
