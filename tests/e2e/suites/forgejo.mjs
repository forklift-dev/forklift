// Forgejo integration against a mock server (API + git over HTTP): adding an account in Preferences (the
// token checked, kept out of the settings), pull requests and issues of the open repository, comments,
// creating both, checking out a pull request (also from a fork) with git using the account's token, #123
// links in commit messages, and the server's repositories in the Clone dialog.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startForgejoMock } from '../forgejoMock.mjs';
import { binary, defer, GIT_IDENTITY, launchApp, tempDir } from '../harness.mjs';

const button = (scope, label) => `[...${scope}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const section = (title) => `document.querySelector('.ref-section[aria-label="${title}"]')`;
const item = (id) => `document.querySelector('[data-hosting="${id}"]')`;
const view = `document.querySelector('.hosting-view')`;
const viewText = `(${view}?.textContent ?? '')`;
const formDialog = `document.querySelector('.form-dialog')`;

export default async function ({ check }) {
  if (binary) return; // FORKLIFT_TEST_BASIC_SECRETS works in development builds only.
  const env = { ...process.env, ...GIT_IDENTITY, GIT_TERMINAL_PROMPT: '0' };
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();

  // The server's repository ada/demo: main, a feature branch, and a fork's pull request at refs/pull/2/head.
  const served = tempDir('forklift-forgejo-');
  const seed = join(served, 'seed');
  sh(served, 'init', '-q', '--initial-branch=main', seed);
  writeFileSync(join(seed, 'a.txt'), 'one\n');
  sh(seed, 'add', '.');
  sh(seed, 'commit', '-qm', 'First');
  sh(seed, 'checkout', '-qb', 'feature');
  writeFileSync(join(seed, 'feature.txt'), 'feature\n');
  sh(seed, 'add', '.');
  sh(seed, 'commit', '-qm', 'Add the feature');
  sh(seed, 'checkout', '-qb', 'fork-fix', 'main');
  writeFileSync(join(seed, 'fix.txt'), 'fix\n');
  sh(seed, 'add', '.');
  sh(seed, 'commit', '-qm', 'Fix from a fork');
  const forkSha = sh(seed, 'rev-parse', 'HEAD');
  sh(seed, 'checkout', '-q', 'main');
  const bare = join(served, 'ada', 'demo.git');
  sh(served, 'clone', '-q', '--bare', seed, bare);
  sh(bare, 'branch', '-D', 'fork-fix');
  sh(bare, 'update-ref', 'refs/pull/2/head', forkSha);
  sh(bare, 'config', 'http.receivepack', 'true');
  const mock = await startForgejoMock({ gitRoot: served });
  defer(() => mock.close());

  const root = join(tempDir('forklift-mine-'), 'demo');
  sh(served, 'clone', '-q', bare, root);
  sh(root, 'remote', 'set-url', 'origin', `${mock.url}/ada/demo.git`);
  writeFileSync(join(root, 'b.txt'), 'two\n');
  sh(root, 'add', '.');
  sh(root, 'commit', '-qm', 'Fixes #3 at last');

  const app = await launchApp({ env: { FORKLIFT_TEST_BASIC_SECRETS: '1' } });
  const { page } = app;
  await page.waitFor(`!!document.querySelector('[aria-label="Preferences"]')`);

  // Preferences → Integrations: a wrong token is refused, the right one adds the account.
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'Integrations')`);
  await page.waitFor(`!!${button(`document.querySelector('.hosting-accounts')`, 'Add an account…')} && !${button(`document.querySelector('.hosting-accounts')`, 'Add an account…')}.disabled`);
  await page.click(button(`document.querySelector('.hosting-accounts')`, 'Add an account…'));
  await page.fill(`document.querySelector('.account-form [name="url"]')`, mock.url);
  await page.fill(`document.querySelector('.account-form [name="token"]')`, 'wrong-token');
  await page.click(button(`document.querySelector('.account-form')`, 'Add account'));
  const refused = await page.waitFor(`document.querySelector('.hosting-accounts .setting-error')?.textContent`, 8000);
  check('a wrong token is refused with the reason', /refused the token/.test(refused ?? ''), refused);
  await page.fill(`document.querySelector('.account-form [name="token"]')`, 'tok-ada');
  await page.click(button(`document.querySelector('.account-form')`, 'Add account'));
  const added = await page.waitFor(`document.querySelector('.hosting-accounts [data-account]')?.textContent`, 8000);
  check('the account is listed with the server’s user name', /Ada Lovelace \(ada\)/.test(added ?? '') && added.includes(mock.url), added);
  const userData = join(app.home, '.config', 'Forklift');
  const settingsFile = readFileSync(join(userData, 'settings.json'), 'utf8');
  const tokensFile = readFileSync(join(userData, 'hosting-tokens.json'), 'utf8');
  check('the token is in neither the settings nor, as plain text, the token file', !settingsFile.includes('tok-ada') && !tokensFile.includes('tok-ada') && settingsFile.includes('"username": "ada"'));
  await page.press('Escape');
  check('Escape still closes Preferences after adding', await page.waitFor(`!document.querySelector('.preferences')`));

  // The repository: its pull requests and issues in the left panel.
  await page.invoke('repo:open', root);
  check('Pull requests lists the open ones', await page.waitFor(`!!${item('pull-1')} && !!${item('pull-2')} && !${item('pull-5')}`, 10000));
  check('a draft pull request is marked', /draft/.test(await page.evaluate(`${item('pull-2')}.textContent`)));
  check('Issues lists open issues with labels', await page.waitFor(`/Crash on start/.test(${item('issue-3')}?.textContent) && /bug/.test(${item('issue-3')}.textContent) && !${item('issue-4')}`));

  // A pull request in the center.
  await page.click(item('pull-1'));
  check('the pull request opens with its description, commits, files and discussion', await page.waitFor(`/It adds \\*\\*the feature\\*\\*/.test(${viewText}) && /src\\/feature\\.txt/.test(${viewText}) && /Looks good to me/.test(${viewText}) && /feature → main/.test(${viewText})`));
  await page.fill(`${view}.querySelector('textarea')`, 'Thanks, merging soon');
  await page.click(button(view, 'Comment'));
  check('a comment is sent and shown', await page.waitFor(`/Thanks, merging soon/.test([...${view}.querySelectorAll('.hosting-comment')].map(c => c.textContent).join())`));
  check('the server got the comment', mock.comments[1].some((c) => c.body === 'Thanks, merging soon'));

  // Checking out pull requests: git fetches with the account's token, nobody is asked.
  const before = mock.requests.filter((r) => r.git).length;
  await page.click(button(view, 'Check out'));
  check('Check out switches to the pull request’s branch', await page.waitFor(`document.querySelector('.toolbar .branch')?.textContent.startsWith('feature')`, 15000));
  check('git used the account’s token (no prompt)', !(await page.evaluate(`!!document.querySelector('.prompt-dialog')`)) && mock.requests.filter((r) => r.git).slice(before).some((r) => r.authorized));
  check('the branch tracks the remote one', sh(root, 'rev-parse', '--abbrev-ref', 'feature@{upstream}') === 'origin/feature');
  await page.click(item('pull-2'));
  await page.waitFor(`/WIP: Fix from a fork/.test(${viewText}) && !!${button(view, 'Check out')}`);
  await page.click(button(view, 'Check out'));
  check('a fork’s pull request becomes the local branch pr/2', await page.waitFor(`document.querySelector('.toolbar .branch')?.textContent.startsWith('pr/2')`, 15000));
  check('pr/2 is at the pull request’s commit', sh(root, 'rev-parse', 'pr/2') === forkSha);
  check('no credential prompt was shown', !(await page.evaluate(`!!document.querySelector('.prompt-dialog')`)));

  // Issues: view and create.
  await page.click(item('issue-3'));
  check('an issue opens with its description', await page.waitFor(`/It crashes\\./.test(${viewText}) && /bug/.test(${viewText}) && !/Check out/.test(${viewText})`));
  await page.click(`${section('Issues')}.querySelector('[aria-label="Create an issue"]')`);
  await page.waitFor(`!!${formDialog}`);
  await page.fill(`${formDialog}.querySelector('[name="title"]')`, 'Made in Forklift');
  await page.fill(`${formDialog}.querySelector('textarea')`, 'Steps: none');
  await page.click(button(formDialog, 'Create issue'));
  check('a new issue is created and shown', await page.waitFor(`!${formDialog} && /Made in Forklift/.test(${viewText}) && /Steps: none/.test(${viewText})`, 8000));
  check('the issue list shows it', await page.waitFor(`[...${section('Issues')}.querySelectorAll('.hosting-item')].some(i => /Made in Forklift/.test(i.textContent))`));

  // #3 in a commit message opens that issue.
  await page.press('Escape');
  await page.waitFor(`!${view}`);
  await page.click(`[...document.querySelectorAll('.commit-row[data-hash]')].find(r => /Fixes #3/.test(r.textContent))`);
  await page.waitFor(`!!document.querySelector('.commit-details .issue-ref')`);
  await page.click(`document.querySelector('.commit-details .issue-ref')`);
  check('#3 in a commit message shows issue #3', await page.waitFor(`/Crash on start/.test(${viewText})`));

  // A pull request from the current branch (feature, pushed).
  await page.invoke('branch:checkout', root, { kind: 'branch', name: 'feature' });
  await page.click(`${section('Pull requests')}.querySelector('[aria-label="Create a pull request"]')`);
  await page.waitFor(`!!${formDialog}`);
  check('the form proposes main as the base', (await page.evaluate(`${formDialog}.querySelector('select').value`)) === 'main');
  await page.fill(`${formDialog}.querySelector('[name="title"]')`, 'Feature, again');
  await page.click(button(formDialog, 'Create pull request'));
  check('the pull request is created from feature into main and shown', await page.waitFor(`!${formDialog} && /Feature, again/.test(${viewText})`, 8000) && mock.pulls[0].head.ref === 'feature' && mock.pulls[0].base.ref === 'main');

  // Clone: the server's repositories.
  await page.press('Escape');
  await page.invoke('repo:close', root);
  await page.click(button(`document.querySelector('.repositories-header')`, 'Clone…'));
  check('Clone lists the account’s repositories', await page.waitFor(`[...document.querySelectorAll('.hosting-repo-list [data-repo]')].map(b => b.dataset.repo).join() === 'ada/secret,ada/demo,team/tools'`, 8000));
  await page.click(`document.querySelector('.hosting-repo-list [data-repo="ada/demo"]')`);
  check('picking one fills the URL', (await page.evaluate(`document.querySelector('.new-repo-dialog [name="url"]').value`)) === `${mock.url}/ada/demo.git`);
  await page.press('Escape');

  // Removing the account forgets its token.
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'Integrations')`);
  await page.click(button(`document.querySelector('.hosting-accounts [data-account]')`, 'Remove'));
  check('Remove takes the account and its token away', await page.waitFor(`!document.querySelector('.hosting-accounts [data-account]')`) && !readFileSync(join(userData, 'hosting-tokens.json'), 'utf8').includes('"url"'));
}
