// Fetch, pull and push against an HTTP remote that needs a password: credentials asked in the app's own
// dialog (askpass bridge), wrong password, cancelling, a rejected push offering force-with-lease.
import { execFile, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startGitHttpServer } from '../gitHttp.mjs';
import { createRepo, defer, GIT_IDENTITY, launchApp, tempDir } from '../harness.mjs';

const toolbarButton = (label) => `[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const promptText = `document.querySelector('.prompt-dialog .prompt-text')?.textContent`;
const top = `document.querySelector('.commit-row[data-hash] .subject')?.textContent`;

async function answer(page, kind, text) {
  const seen = await page.waitFor(`/${kind}/i.test(${promptText} ?? '') && ${promptText}`, 10000);
  await page.fill(`document.querySelector('.prompt-dialog input')`, text);
  await page.click(`[...document.querySelectorAll('.prompt-dialog button')].find(b => b.textContent === 'Continue')`);
  await page.waitFor(`!document.querySelector('.prompt-dialog') || document.querySelector('.prompt-dialog .prompt-text')?.textContent !== ${JSON.stringify(seen)}`);
  return seen;
}

export default async function ({ check }) {
  const served = tempDir('forklift-served-');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', join(served, 'origin.git')]);
  execFileSync('git', ['config', 'http.receivepack', 'true'], { cwd: join(served, 'origin.git') });
  const http = await startGitHttpServer(served, { user: 'ada', password: 'lovelace' });
  defer(() => http.close());
  const authed = `${http.url.replace('http://', 'http://ada:lovelace@')}/origin.git`;
  const plain = `${http.url}/origin.git`;
  const env = { ...process.env, ...GIT_IDENTITY, GIT_TERMINAL_PROMPT: '0' };

  // Their clone pushes with credentials in the URL; ours uses the plain URL, so the app has to ask.
  // Network commands run asynchronously: the HTTP server answering them lives in this process.
  const net = (cwd, ...args) =>
    new Promise((resolve, reject) => execFile('git', args, { cwd, env }, (error, stdout) => (error ? reject(error) : resolve(stdout.trim()))));
  const theirs = tempDir('forklift-theirs-');
  await net(served, 'clone', '-q', authed, theirs);
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim();
  // An empty repository cloned over HTTP starts on git's default branch name; use main.
  sh(theirs, 'checkout', '-qb', 'main');
  writeFileSync(join(theirs, 'a.txt'), 'one\n');
  sh(theirs, 'add', '.');
  sh(theirs, 'commit', '-qm', 'First');
  await net(theirs, 'push', '-q', '-u', 'origin', 'main');
  const { root, git } = createRepo({ dir: join(tempDir('forklift-mine-'), 'mine') });
  git('remote', 'add', 'origin', plain);
  await net(root, 'fetch', '-q', authed, 'main:refs/remotes/origin/main');
  git('reset', '-q', '--hard', 'origin/main');
  git('branch', '-q', '--set-upstream-to=origin/main');

  sh(theirs, 'commit', '-q', '--allow-empty', '-m', 'Second, from them');
  await net(theirs, 'push', '-q');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`${top} === 'First'`);

  // Pull: username and password asked in the app.
  await page.click(toolbarButton('Pull'));
  const userPrompt = await answer(page, 'Username', 'ada');
  check('git asks for the username in the app', /Username for 'http:\/\/127\.0\.0\.1:\d+'/.test(userPrompt ?? ''), userPrompt);
  const passwordPrompt = await page.waitFor(`/Password/.test(${promptText} ?? '') && document.querySelector('.prompt-dialog input').type`);
  check('…and the password in a masked field', passwordPrompt === 'password', passwordPrompt);
  await answer(page, 'Password', 'lovelace');
  check('pull brings their commit', (await page.waitFor(`${top} === 'Second, from them' && ${top}`, 15000)) === 'Second, from them');

  // A wrong password: git's refusal is shown.
  sh(theirs, 'commit', '-q', '--allow-empty', '-m', 'Third, from them');
  await net(theirs, 'push', '-q');
  await page.click(`document.querySelector('[aria-label="More pull options"]')`);
  await page.click(`[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === 'Fetch all')`);
  await answer(page, 'Username', 'ada');
  await answer(page, 'Password', 'wrong');
  const failure = await page.waitFor(`document.querySelector('.error-banner')?.textContent`, 15000);
  check('a wrong password fails with git’s message', /Authentication failed|401|denied/i.test(failure ?? ''), failure);

  // Cancel in the credential dialog: git gives up, the pull ends.
  await page.click(toolbarButton('Pull'));
  await page.waitFor(`/Username/.test(${promptText} ?? '')`, 10000);
  check('progress and Cancel shown in the toolbar while it runs', /Pulling/.test((await page.evaluate(`document.querySelector('.remote-activity')?.textContent`)) ?? ''));
  await page.click(`[...document.querySelectorAll('.prompt-dialog button')].find(b => b.textContent === 'Cancel')`);
  check('cancelling the prompt stops the pull', await page.waitFor(`!document.querySelector('.prompt-dialog') && !document.querySelector('.remote-activity')`, 10000));

  // Push our commit.
  writeFileSync(join(root, 'mine.txt'), 'mine\n');
  git('add', '.');
  git('commit', '-qm', 'Mine');
  await page.waitFor(`${top} === 'Mine'`, 5000);
  await page.click(toolbarButton('Pull'));
  await answer(page, 'Username', 'ada');
  await answer(page, 'Password', 'lovelace');
  await page.waitFor(`!document.querySelector('.remote-activity')`, 15000);
  await page.click(toolbarButton('Push'));
  await answer(page, 'Username', 'ada');
  await answer(page, 'Password', 'lovelace');
  await page.waitFor(`!document.querySelector('.remote-activity')`, 15000);
  check('push reaches the remote', (await net(theirs, 'ls-remote', 'origin', 'main')).split('\t')[0] === git('rev-parse', 'HEAD'));

  // They rewrite history; our push is rejected and a force push is offered (we decline).
  await net(theirs, 'pull', '-q', '--rebase');
  sh(theirs, 'commit', '-q', '--allow-empty', '-m', 'Theirs after mine');
  await net(theirs, 'push', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'Mine again');
  await page.click(toolbarButton('Push'));
  await answer(page, 'Username', 'ada');
  await answer(page, 'Password', 'lovelace');
  const offer = await page.waitFor(`document.querySelector('.modal h2')?.textContent`, 15000);
  check('a rejected push offers pulling or a force push', /The remote has commits that main does not have/.test(offer ?? ''), offer);
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Cancel')`);
  check('the password never reaches the request log as text', !JSON.stringify(http.requests).includes('lovelace'));
}
