// Avatars: colored initials in the graph and the commit details, the same color for the same email, and no
// requests for pictures while Gravatar is off (the default). Gravatar itself is covered by unit tests: an
// end-to-end run would send real requests to gravatar.com.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, tempDir } from '../harness.mjs';

const fnv = (text) => {
  let hash = 0x811c9dc5;
  for (const char of text.trim().toLowerCase()) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 10;
};

export default async function ({ check }) {
  const { root, git, write } = createRepo({ dir: join(tempDir('forklift-avatars-'), 'repo') });
  const commitAs = (name, email, message) => {
    write(`${message}.txt`, message);
    git('add', '.');
    git('-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-qm', message, '--author', `${name} <${email}>`);
  };
  commitAs('Ada Lovelace', 'ada@example.com', 'one');
  commitAs('Grace Hopper', 'grace@example.com', 'two');
  commitAs('Ada Lovelace', 'ada@example.com', 'three');

  const home = tempDir('forklift-home-');
  const { page } = await launchApp({ home });
  await page.invoke('repo:open', root);
  await page.waitFor(`document.querySelectorAll('.commit-row[data-hash] .avatar').length === 3`);
  const avatars = await page.evaluate(`[...document.querySelectorAll('.commit-row[data-hash] .avatar')].map(a => a.className + '|' + a.textContent)`);
  check('initials in the graph', JSON.stringify(avatars.map((a) => a.split('|')[1])) === JSON.stringify(['AL', 'GH', 'AL']), JSON.stringify(avatars));
  check('the same email always gets the same color', avatars[0] === avatars[2] && avatars[0].includes(`lane-${fnv('ada@example.com')}`) && avatars[1].includes(`lane-${fnv('grace@example.com')}`), JSON.stringify(avatars));
  check('initials are pictures of text, not images', await page.evaluate(`!document.querySelector('img.avatar')`));
  await page.click(`document.querySelector('.commit-row[data-hash]')`);
  check('initials in the commit details', await page.waitFor(`document.querySelector('.commit-person .avatar')?.textContent === 'AL'`));

  const answer = await page.invoke('avatars:get', ['ada@example.com']);
  check('main hands out no pictures while Gravatar is off', answer?.ok === true && JSON.stringify(answer.value) === '{}', JSON.stringify(answer));
  const configDir = readdirSync(join(home, '.config')).find((name) => existsSync(join(home, '.config', name, 'settings.json')) || name === 'Forklift');
  check('nothing was fetched or cached', !existsSync(join(home, '.config', configDir ?? 'Forklift', 'avatars')));

  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'UI')`);
  check('the Gravatar option is in Preferences → UI, off', await page.waitFor(`document.querySelector('.setting-row[data-setting="ui.gravatar"] input[type="checkbox"]')?.checked === false`));
}
