// A new local branch can be published and tracked from the Russian UI. This regresses the old implementation,
// which recognized "has no upstream branch" by its English error text and therefore never opened the dialog.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createRepo, launchApp, tempDir } from '../harness.mjs';

const pushButton = `[...document.querySelectorAll('.toolbar .tool-button')].find(b => b.textContent.trim() === 'Push')`;
const primary = `[...document.querySelectorAll('.modal button')].find(b => b.textContent.trim() === 'Push')`;

export default async function ({ check }) {
  const served = tempDir('forklift-push-upstream-');
  const origin = join(served, 'origin.git');
  const backup = join(served, 'backup.git');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', backup]);

  const { root, git, write } = createRepo();
  write('one.txt', 'one\n');
  git('add', '.');
  git('commit', '-qm', 'One');
  git('remote', 'add', 'origin', origin);

  const { page } = await launchApp({ lang: 'ru-RU' });
  await page.invoke('repo:open', root);
  await page.waitFor(`document.documentElement.lang === 'ru' && !!${pushButton}`);

  // One remote: a simple confirmation creates origin/main and sets it as upstream.
  await page.click(pushButton);
  const oneTitle = await page.waitFor(`document.querySelector('.modal h2')?.textContent`);
  check('a Russian UI offers to publish a branch with no upstream', oneTitle === 'Push ветки main в origin?', oneTitle);
  await page.click(primary);
  check('the first push creates and tracks origin/main', await page.waitFor(`document.querySelector('.upstream-value')?.textContent === 'origin/main'`, 10000) && git('rev-parse', '--abbrev-ref', 'main@{upstream}') === 'origin/main' && Boolean(git('--git-dir', origin, 'show-ref', '--verify', 'refs/heads/main')));

  // Multiple remotes: choose where the new branch is published.
  git('remote', 'add', 'backup', backup);
  git('switch', '-qc', 'feature');
  await page.invoke('repo:refresh', root);
  await page.waitFor(`document.querySelector('.toolbar .branch')?.textContent === 'feature'`);
  await page.click(pushButton);
  await page.waitFor(`!!document.querySelector('.form-dialog select[name="remote"]')`);
  await page.selectOption(`document.querySelector('.form-dialog select[name="remote"]')`, 'backup');
  await page.click(primary);
  check('with several remotes the selected one is created and tracked', await page.waitFor(`document.querySelector('.upstream-value')?.textContent === 'backup/feature'`, 10000) && git('rev-parse', '--abbrev-ref', 'feature@{upstream}') === 'backup/feature' && Boolean(git('--git-dir', backup, 'show-ref', '--verify', 'refs/heads/feature')));
  check('the other remote did not receive the branch', git.allowFail('--git-dir', origin, 'show-ref', '--verify', 'refs/heads/feature') === '');
}
