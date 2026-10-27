// Local repository groups: create, drag in a recent repo, show its status, then open and close the group.
import { basename } from 'node:path';
import { createRepo, launchApp } from '../harness.mjs';

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('README.md', 'Group test\n');
  git('add', '.');
  git('commit', '-qm', 'initial');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`document.querySelectorAll('.tab-name').length === 1`);
  await page.click(`document.querySelector('.new-tab')`);
  await page.waitFor(`!!document.querySelector('.repositories')`);
  await page.fill(`document.querySelector('.repo-group-create input')`, 'Work');
  await page.click(`document.querySelector('.repo-group-create button[type="submit"]')`);
  await page.waitFor(`document.querySelector('.repo-group input[aria-label="Group name"]')?.value === 'Work'`);

  const encodedRoot = JSON.stringify(root);
  await page.evaluate(`(() => {
    const group = document.querySelector('.repo-group');
    const data = new DataTransfer();
    data.setData('text/x-forklift-repository', ${encodedRoot});
    group.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  })()`);
  await page.waitFor(`!!document.querySelector('.repo-group .repo-row')`);
  check('a recent repository can be dragged into the group', await page.evaluate(`document.querySelector('.repo-group .repo-row')?.dataset.path === ${encodedRoot}`));
  check('group shows branch and working tree status', await page.waitFor(`document.querySelector('.repo-group-status')?.textContent.includes('main') && document.querySelector('.repo-group-status')?.textContent.includes('Clean')`));
  await page.click(`document.querySelector('.repo-group-color-trigger')`);
  check('group colors are displayed in the picker', await page.evaluate(`document.querySelectorAll('.repo-group-color-option span').length === 10`));
  await page.click(`document.querySelector('.repo-group-color-option.lane-4')`);
  check('group color can be changed', await page.waitFor(`document.querySelector('.repo-group').classList.contains('lane-4')`));

  await page.click(`document.querySelector('.repo-group-header > button')`);
  check('Open group opens its repository in a tab', await page.waitFor(`document.querySelector('.tab-name')?.textContent === ${JSON.stringify(basename(root))}`));
  await page.click(`document.querySelector('.new-tab')`);
  await page.waitFor(`!!document.querySelector('.repositories')`);
  await page.waitFor(`document.querySelector('.repo-group-header > button')?.textContent.trim() === 'Close group'`);
  await page.click(`document.querySelector('.repo-group-header > button')`);
  check('Close group closes its open tabs', await page.waitFor(`document.querySelector('.tab-name') === null`));
}
