// Remembered passwords: the first fetch asks and (with "Remember") keeps them, later fetches do not ask,
// Preferences lists and forgets them, and without "Remember" nothing is kept. The app's credential helper
// encrypts with safeStorage; under xvfb there is no keyring, so this dev build allows Chromium's basic store.
import { execFile, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { startGitHttpServer } from '../gitHttp.mjs';
import { binary, createRepo, defer, GIT_IDENTITY, launchApp, tempDir } from '../harness.mjs';

const promptText = `document.querySelector('.prompt-dialog .prompt-text')?.textContent`;

async function answer(page, kind, text, remember) {
  const seen = await page.waitFor(`/${kind}/i.test(${promptText} ?? '') && ${promptText}`, 10000);
  if (remember !== undefined) {
    const box = `document.querySelector('.prompt-dialog [name="remember"]')`;
    if ((await page.evaluate(`${box}?.checked`)) !== remember) await page.click(box);
  }
  await page.fill(`document.querySelector('.prompt-dialog input:not([type="checkbox"])')`, text);
  await page.click(`[...document.querySelectorAll('.prompt-dialog button')].find(b => b.textContent === 'Continue')`);
  await page.waitFor(`!document.querySelector('.prompt-dialog') || ${promptText} !== ${JSON.stringify(seen)}`);
  return seen;
}

export default async function ({ check }) {
  if (binary) return; // FORKLIFT_TEST_BASIC_SECRETS works in development builds only.
  const served = tempDir('forklift-served-');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', join(served, 'origin.git')]);
  execFileSync('git', ['config', 'http.receivepack', 'true'], { cwd: join(served, 'origin.git') });
  const http = await startGitHttpServer(served, { user: 'ada', password: 'lovelace' });
  defer(() => http.close());
  const env = { ...process.env, ...GIT_IDENTITY, GIT_TERMINAL_PROMPT: '0' };
  const theirs = tempDir('forklift-theirs-');
  await new Promise((resolve, reject) => execFile('git', ['clone', '-q', `${http.url.replace('http://', 'http://ada:lovelace@')}/origin.git`, theirs], { env }, (e) => (e ? reject(e) : resolve())));
  const { root, git } = createRepo({ dir: join(tempDir('forklift-mine-'), 'mine') });
  git('remote', 'add', 'origin', `${http.url}/origin.git`);

  const { page } = await launchApp({ env: { FORKLIFT_TEST_BASIC_SECRETS: '1' } });
  await page.invoke('repo:open', root);
  const fetch = () => page.invoke('remote:fetch', root, null, false);
  const asks = async () => {
    const done = fetch();
    const asked = await page.waitFor(`!!document.querySelector('.prompt-dialog')`, 3000);
    return { done, asked };
  };

  // First fetch: asked, remembered.
  let run = await asks();
  check('the first fetch asks', run.asked);
  check('"Remember" is offered for the password, on by default', (await answer(page, 'Username', 'ada'), await page.waitFor(`document.querySelector('.prompt-dialog [name="remember"]')?.checked === true`)));
  await answer(page, 'Password', 'lovelace', true);
  check('the fetch succeeds', (await run.done)?.ok === true);

  // Second fetch: no questions.
  run = await asks();
  check('the next fetch does not ask again', !run.asked && (await run.done)?.ok === true);

  // Preferences lists it; forgetting it makes git ask again.
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'Profiles and keys')`);
  const row = `document.querySelector('.saved-passwords li[data-credential]')`;
  const listed = await page.waitFor(`${row}?.textContent`, 5000);
  check('Preferences lists the saved password (user and host, not the password)', /ada/.test(listed ?? '') && /127\.0\.0\.1/.test(listed ?? '') && !/lovelace/.test(listed ?? ''), listed);
  await page.click(`[...${row}.querySelectorAll('button')].find(b => b.textContent === 'Forget')`);
  check('Forget removes it', await page.waitFor(`!${row}`, 5000));
  await page.press('Escape');
  run = await asks();
  check('after Forget git asks again', run.asked);

  // Without "Remember": nothing is kept.
  await answer(page, 'Username', 'ada');
  await answer(page, 'Password', 'lovelace', false);
  await run.done;
  run = await asks();
  check('without "Remember" the next fetch asks again', run.asked);
  await answer(page, 'Username', 'ada');
  await answer(page, 'Password', 'lovelace', false);
  await run.done;
}
