// Commit graph: lanes for a merged branch, WIP row, selection with mouse and keys, virtualized
// scrolling through a long generated history that is fetched page by page.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createRepo, launchApp, projectDir, tempDir } from '../harness.mjs';

const dataRows = `[...document.querySelectorAll('.commit-row[data-hash]')]`;

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('a.txt', 'base\n');
  git('add', '.');
  git('commit', '-qm', 'Base');
  git('checkout', '-qb', 'feature');
  write('b.txt', 'feature\n');
  git('add', '.');
  git('commit', '-qm', 'Feature work');
  git('checkout', '-q', 'main');
  write('a.txt', 'main\n');
  git('commit', '-qam', 'Main work');
  git('merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature');
  git('tag', 'v1');
  write('a.txt', 'uncommitted\n');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`${dataRows}.length === 4`);
  const subjects = await page.evaluate(`${dataRows}.map(r => r.querySelector('.subject').textContent).join(' | ')`);
  check('history in topological order', subjects === 'Merge feature | Main work | Feature work | Base', subjects);
  const columns = await page.evaluate(`${dataRows}.map(r => r.querySelector('.node, .node-ring').getAttribute('cx')).join(',')`);
  const [merge, main, feature, base] = columns.split(',').map(Number);
  check('merged branch drawn in its own lane, joining at merge and fork point', merge === main && feature > main && base === main, columns);
  check('merge commit draws two lines out of its node', (await page.evaluate(`${dataRows}[0].querySelectorAll('path.edge').length`)) >= 2);
  const badges = await page.evaluate(`[...${dataRows}[0].querySelectorAll('.ref')].map(r => r.textContent).join(',')`);
  check('branch and tag labels on the commit', badges.includes('main') && badges.includes('v1'), badges);

  // WIP row on top; selecting a commit shows its details, the WIP row the working changes.
  check('WIP row shows uncommitted changes', /1 unstaged/.test((await page.evaluate(`document.querySelector('.commit-row.wip')?.textContent`)) ?? ''));
  check('WIP row selected initially', await page.evaluate(`document.querySelector('.commit-row.wip').classList.contains('selected')`));
  await page.click(`${dataRows}[1]`);
  check('click selects a commit and shows its details', (await page.waitFor(`document.querySelector('.commit-details .commit-subject')?.textContent`)) === 'Main work');
  await page.press('ArrowDown', { code: 'ArrowDown', keyCode: 40 });
  check('ArrowDown selects the next commit', (await page.waitFor(`document.querySelector('.commit-details .commit-subject')?.textContent === 'Feature work' && 'ok'`)) === 'ok');
  await page.press('ArrowUp', { code: 'ArrowUp', keyCode: 38 });
  await page.press('ArrowUp', { code: 'ArrowUp', keyCode: 38 });
  await page.press('ArrowUp', { code: 'ArrowUp', keyCode: 38 });
  check('ArrowUp to the top selects the WIP row (working changes)', await page.waitFor(`!document.querySelector('.commit-details') && !!document.querySelector('.changes')`));

  // A long history: rendered rows stay few, pages arrive as the list scrolls.
  const big = tempDir('forklift-big-');
  execFileSync(process.execPath, [join(projectDir, 'scripts/make-history-repo.mjs'), big, '3000', '3'], { stdio: 'ignore' });
  await page.invoke('repo:open', big);
  await page.waitFor(`${dataRows}.length > 20`, 15000);
  const rendered = await page.evaluate(`document.querySelectorAll('.commit-row').length`);
  check('only rows near the viewport are rendered', rendered < 120, `${rendered} rows in the DOM`);
  let last = '';
  for (let i = 0; i < 40 && !last; i++) {
    await page.evaluate(`document.querySelector('.commit-scroll').scrollTop = 1e9`);
    await page.waitFor(`false`, 150);
    last = await page.evaluate(`(() => { const rows = ${dataRows}; const end = rows.at(-1); return end && end.querySelector('.subject').textContent === 'Initial commit' ? end.dataset.hash : ''; })()`);
  }
  check('scrolling to the end reaches the first commit of 3000', last === execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: big }).toString().trim(), last);
  const height = await page.evaluate(`document.querySelector('.commit-rows').style.height`);
  const rowHeight = await page.evaluate(`Math.round(document.querySelector('.commit-row[data-hash]').getBoundingClientRect().height)`);
  check('list height matches the whole history once walked', height === `${3000 * rowHeight}px`, `${height} (rows of ${rowHeight} px)`);
}
