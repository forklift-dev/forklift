// Profiles and keys: generating an SSH key, a profile with SSH signing applied to one repository, the commit
// form naming who commits, a signed commit verified in its details, switching profiles from the palette.
// Runs with a throwaway HOME, no ssh-agent and its own GNUPGHOME: the user's keys are never touched.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, tempDir } from '../harness.mjs';

export const meta = { platforms: ['linux', 'darwin'] };

const CTRL = 2;
const SHIFT = 8;
const prefsNav = (name) => `[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === ${JSON.stringify(name)})`;
const button = (scope, label) => `[...${scope}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
const identity = `document.querySelector('.commit-identity')?.textContent`;

export default async function ({ check }) {
  const home = tempDir('forklift-home-');
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Ada\n\temail = ada@example.com\n');
  mkdirSync(join(home, 'gnupg'), { mode: 0o700 });
  const { root, git, write } = createRepo({ dir: join(tempDir('forklift-profiles-'), 'repo') });
  write('a.txt', 'one\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const env = { SSH_AUTH_SOCK: undefined, GNUPGHOME: join(home, 'gnupg'), GIT_AUTHOR_NAME: undefined, GIT_AUTHOR_EMAIL: undefined, GIT_COMMITTER_NAME: undefined, GIT_COMMITTER_EMAIL: undefined };
  const { page } = await launchApp({ home, env });
  await page.invoke('repo:open', root);
  check('the commit form says who commits', await page.waitFor(`/as Ada <ada@example\\.com>/.test(${identity} ?? '')`, 5000), await page.evaluate(identity));

  // Generate a key.
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(prefsNav('Profiles and keys'));
  await page.waitFor(`!!document.querySelector('.ssh-keys')`);
  check('no ssh-agent is reported', await page.waitFor(`/No ssh-agent is running/.test(document.querySelector('.ssh-keys').textContent)`));
  await page.click(button(`document.querySelector('.ssh-keys')`, 'Generate a key…'));
  await page.fill(`document.querySelector('[name="keyName"]')`, 'id_work');
  await page.fill(`document.querySelector('[name="keyComment"]')`, 'ada@work.example');
  await page.click(button(`document.querySelector('.ssh-generate')`, 'Generate ed25519 key'));
  const keyPath = join(home, '.ssh', 'id_work');
  check('the key is generated into ~/.ssh and listed', await page.waitFor(`!!document.querySelector('.ssh-key-list li[data-key=${JSON.stringify(JSON.stringify(keyPath)).slice(1, -1)}]')`, 10000));
  await page.click(button(`document.querySelector('.ssh-key-list li')`, 'Copy public key'));
  check('the public key can be copied', await page.waitFor(`/Public key copied/.test(document.querySelector('.ssh-keys').textContent)`));

  // A profile signing with it, for this repository only.
  await page.click(button(`document.querySelector('.profiles')`, 'Add a profile'));
  const form = `document.querySelector('.profile-form')`;
  check('a new profile starts with the current identity', await page.waitFor(`${form}?.querySelector('[name="email"]').value === 'ada@example.com'`));
  await page.fill(`${form}.querySelector('[name="label"]')`, 'Work');
  await page.fill(`${form}.querySelector('[name="userName"]')`, 'Ada Work');
  await page.fill(`${form}.querySelector('[name="email"]')`, 'ada@work.example');
  await page.selectOption(`${form}.querySelector('[name="sshKey"]')`, keyPath);
  await page.selectOption(`${form}.querySelector('[name="signing"]')`, 'ssh');
  await page.waitFor(`!!${form}.querySelector('[name="signingKey"]')`);
  await page.selectOption(`${form}.querySelector('[name="signingKey"]')`, `${keyPath}.pub`);
  await page.click(button(form, 'Use for this repository'));
  const applied = await page.waitFor(`${form}.querySelector('.setting-ok, .setting-error')?.textContent`, 5000);
  check('the profile is saved and applied to the repository', applied === 'In use in this repository', applied);
  const local = (key) => execFileSync('git', ['config', '--local', key], { cwd: root }).toString().trim();
  check('git config of the repository has the profile', local('user.email') === 'ada@work.example' && local('gpg.format') === 'ssh' && local('commit.gpgsign') === 'true' && local('core.sshCommand').includes('id_work'));
  await page.press('Escape');
  const shown = await page.waitFor(`/as Ada Work <ada@work\\.example> · Work · .*signed/.test(${identity} ?? '') && ${identity}`, 5000);
  check('the commit form names the profile and signing', Boolean(shown), await page.evaluate(identity));

  // A signed commit, verified.
  write('b.txt', 'two\n');
  await page.waitFor(`[...document.querySelectorAll('.change-row')].some(r => r.textContent.includes('b.txt'))`, 5000);
  await page.invoke('index:stage', root, ['b.txt']);
  await page.fill(`document.querySelector('.commit-summary')`, 'Signed work');
  await page.waitFor(`!${button(`document.querySelector('.commit-panel')`, 'Commit 1 file')}?.disabled`);
  await page.click(button(`document.querySelector('.commit-panel')`, 'Commit 1 file'));
  await page.waitFor(`[...document.querySelectorAll('.commit-row[data-hash] .subject')].some((s) => s.textContent === 'Signed work')`, 10000);
  check('the commit is by the profile', execFileSync('git', ['log', '-1', '--format=%an <%ae>'], { cwd: root }).toString().trim() === 'Ada Work <ada@work.example>');
  await page.click(`document.querySelector('.commit-row[data-hash]')`);
  const signature = await page.waitFor(`document.querySelector('.signature')?.textContent`, 10000);
  check('its signature is verified in the details', /Verified · SSH · ada@work\.example/.test(signature ?? ''), signature);
  await page.click(`[...document.querySelectorAll('.commit-row[data-hash]')].find(r => r.textContent.includes('init'))`);
  check('an unsigned commit shows no signature', await page.waitFor(`document.querySelector('.commit-subject')?.textContent === 'init' && !document.querySelector('.signature')`, 5000));

  // Switch profiles from the palette (the commit form is back once the details close).
  await page.click(`document.querySelector('.close-details')`);
  await page.waitFor(`!!document.querySelector('.commit-identity')`);
  await page.invoke('settings:update', {
    values: {
      'profiles.list': [
        { id: 'profile-1', label: 'Work', userName: 'Ada Work', email: 'ada@work.example', sshKey: keyPath, signing: 'ssh', signingKey: `${keyPath}.pub` },
        { id: 'home', label: 'Home', userName: 'Ada H', email: 'ada@home.example', sshKey: '', signing: 'none', signingKey: '' },
      ],
    },
  });
  await page.press('P', { code: 'KeyP', keyCode: 80, modifiers: CTRL | SHIFT });
  await page.insertText('switch profile');
  await page.waitFor(`document.querySelector('.palette-item.active')?.textContent.includes('Switch profile')`);
  await page.press('Enter');
  check('the switcher marks the profile in use', await page.waitFor(`[...document.querySelectorAll('.palette-item')].some(i => i.textContent.includes('Work') && i.textContent.includes('in use'))`, 5000));
  await page.insertText('home');
  await page.waitFor(`document.querySelector('.palette-item.active')?.textContent.includes('Home')`);
  await page.press('Enter');
  const globalEmail = () => execFileSync('git', ['config', '--global', 'user.email'], { env: { ...process.env, HOME: home } }).toString().trim();
  await page.waitFor(`!document.querySelector('.palette')`);
  for (let i = 0; i < 50 && globalEmail() !== 'ada@home.example'; i++) await new Promise((r) => setTimeout(r, 100));
  check('Enter uses the profile for all repositories', globalEmail() === 'ada@home.example');
  check('the repository keeps its own profile', /Ada Work/.test((await page.evaluate(identity)) ?? ''));
  await page.press('P', { code: 'KeyP', keyCode: 80, modifiers: CTRL | SHIFT });
  await page.insertText('switch profile');
  await page.waitFor(`document.querySelector('.palette-item.active')?.textContent.includes('Switch profile')`);
  await page.press('Enter');
  await page.insertText('home');
  await page.waitFor(`document.querySelector('.palette-item.active')?.textContent.includes('Home')`);
  await page.press('Enter', { modifiers: SHIFT });
  check('Shift+Enter uses it for this repository', await page.waitFor(`/as Ada H <ada@home\\.example> · Home/.test(${identity} ?? '')`, 5000), await page.evaluate(identity));
}
