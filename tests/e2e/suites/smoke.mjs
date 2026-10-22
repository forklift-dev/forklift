// Startup, isolation of the page from Node, IPC validation, and a repository rendered from main's state.
import { createRepo, launchApp } from '../harness.mjs';

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('a.txt', '1\n');
  git('add', '.');
  git('commit', '-qm', 'Initial import');
  git('tag', 'v0.1');
  write('a.txt', '2\n');
  git('commit', '-qam', 'Second change');
  write('b.txt', 'untracked\n');

  const app = await launchApp();
  const { page } = app;
  const url = await page.evaluate('location.href');
  check('page loaded from app://', url.startsWith('app://forklift/'), url);
  check('Repositories screen shown without tabs', await page.waitFor(`!!document.querySelector('.repositories') && document.querySelectorAll('.tab').length === 0`));
  const gitLine = await page.waitFor(`document.getElementById('root').innerText.match(/git (\\d+\\.\\d+\\.\\d+)/)?.[0]`);
  check('git version via process host shown', /^git \d+\.\d+\.\d+$/.test(gitLine ?? ''), gitLine);
  check('no Node globals in page', (await page.evaluate('typeof require + "/" + typeof process')) === 'undefined/undefined');
  const bridge = await page.evaluate('Object.keys(window.forklift).sort().join(",")');
  check('bridge exposes only the API', bridge === 'ackReplicaUpdate,invoke,onReplicaMessage,pathForFile,platform', bridge);

  const opened = await page.invoke('repo:open', root);
  check('repo:open via IPC returns the tab id', opened?.ok === true && opened.value === root, JSON.stringify(opened));
  check('tab shown for the repository', await page.waitFor(`document.querySelector('.tab.active .tab-name')?.textContent === ${JSON.stringify(root.split('/').pop())}`));
  // invoke resolves only after the replica acked, so the DOM shows the repo right away.
  const body = await page.waitFor(`document.getElementById('root').innerText.includes('Second change') && document.getElementById('root').innerText`);
  check('commits rendered', body.includes('Second change') && body.includes('Initial import'));
  check('branch rendered', body.includes('main'));
  check('tag decoration rendered', body.includes('tag: v0.1'));
  check('untracked file rendered', body.includes('b.txt'));

  const unknown = await page.evaluate(`window.forklift.invoke('fs:rm', '/').then(r => JSON.stringify(r), e => 'rejected: ' + e.message)`);
  check('unknown command rejected in preload', unknown.startsWith('rejected'), unknown);
  const badArg = await page.invoke('repo:open', 42);
  check('invalid argument rejected in main', badArg?.ok === false, JSON.stringify(badArg));
}
