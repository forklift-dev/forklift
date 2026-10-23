// History search (Ctrl+F) across a long generated history, result navigation, branch solo/hide, Go to HEAD,
// and jumping to a branch whose commit is far down the list.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { GIT_IDENTITY, launchApp, projectDir, tempDir } from '../harness.mjs';

const detailsSubject = `document.querySelector('.commit-details .commit-subject')?.textContent`;
const count = `document.querySelector('.search-count')?.textContent`;

export default async function ({ check }) {
  const root = join(tempDir('forklift-search-'), 'repo');
  execFileSync(process.execPath, [join(projectDir, 'scripts/make-history-repo.mjs'), root, '3000', '5'], { stdio: 'ignore' });
  const git = (...args) => execFileSync('git', args, { cwd: root, env: { ...process.env, ...GIT_IDENTITY } }).toString().trim();
  // An old branch whose tip is deep in the list, and a recognisable author.
  git('branch', 'ancient', git('rev-list', '--max-parents=0', 'HEAD'));
  git('commit', '-q', '--allow-empty', '-m', 'Needle in the haystack', '--author=Zed Searcher <zed@example.com>');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`document.querySelectorAll('.commit-row[data-hash]').length > 10`, 15000);

  await page.evaluate(`document.querySelector('.commit-scroll').focus()`);
  await page.press('f', { code: 'KeyF', keyCode: 70, modifiers: 2 });
  check('Ctrl+F opens the search', await page.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Search commits'`));
  await page.insertText('Initial commit');
  check('a match deep in 3000 commits is found', (await page.waitFor(`/of 1$/.test(${count} ?? '') && ${count}`, 15000)) === '1 of 1', await page.evaluate(count));
  await page.press('Enter');
  check('Enter selects it and scrolls there', (await page.waitFor(`${detailsSubject} === 'Initial commit' && ${detailsSubject}`, 10000)) === 'Initial commit');
  check('the match is highlighted', await page.waitFor(`!!document.querySelector('.commit-row.match.selected')`));

  await page.selectOption(`document.querySelector('[aria-label="Search in"]')`, 'author');
  await page.fill(`document.querySelector('[aria-label="Search commits"]')`, 'zed searcher');
  await page.waitFor(`/of 1$/.test(${count} ?? '')`, 15000);
  await page.press('Enter');
  check('author search', (await page.waitFor(`${detailsSubject} === 'Needle in the haystack' && ${detailsSubject}`)) === 'Needle in the haystack');

  await page.selectOption(`document.querySelector('[aria-label="Search in"]')`, 'message');
  await page.fill(`document.querySelector('[aria-label="Search commits"]')`, 'Merge feature');
  const many = await page.waitFor(`/of \\d{2,}/.test(${count} ?? '') && ${count}`, 15000);
  check('many matches counted', /^1 of \d{2,}$/.test(many ?? ''), many);
  await page.press('Enter');
  await page.press('Enter');
  check('Enter moves to the next match', /^2 of/.test((await page.evaluate(count)) ?? ''));
  await page.press('Escape');
  check('Esc closes the search', await page.waitFor(`!document.querySelector('[aria-label="Search commits"].focus, .history-search')`));

  // A branch far down: clicking it in the left panel finds and selects its commit.
  await page.click(`document.querySelector('.ref-item[data-ref="ancient"]')`);
  check('clicking a far branch reveals its commit', (await page.waitFor(`${detailsSubject} === 'Initial commit' && ${detailsSubject}`, 10000)) === 'Initial commit');
  await page.click(`document.querySelector('.go-head')`);
  check('Go to HEAD selects the checked-out commit', (await page.waitFor(`${detailsSubject} === 'Needle in the haystack' && ${detailsSubject}`)) === 'Needle in the haystack');

  // Solo and hide.
  const menu = async (ref, label) => {
    await page.evaluate(`(() => { const el = document.querySelector('.ref-item[data-ref="${ref}"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 8 })); })()`);
    await page.click(`[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === ${JSON.stringify(label)})`);
  };
  await menu('ancient', 'Show only this in the graph');
  check('solo shows only that branch', await page.waitFor(`document.querySelectorAll('.commit-row[data-hash]').length === 1 && /Showing only ancient/.test(document.querySelector('.filter-status')?.textContent ?? '')`, 10000));
  await page.click(`[...document.querySelectorAll('.filter-status button')].find(b => b.textContent === 'Show all branches')`);
  await page.waitFor(`document.querySelectorAll('.commit-row[data-hash]').length > 10`, 10000);
  await menu('main', 'Hide in the graph');
  const hidden = await page.waitFor(`/1 branch hidden/.test(document.querySelector('.filter-status')?.textContent ?? '') && !document.querySelector('.commit-row[data-hash] .subject')?.textContent.includes('Needle') && document.querySelector('.commit-row[data-hash] .subject')?.textContent`, 10000);
  check('hiding main drops its own commits from the graph', Boolean(hidden) && !/Needle/.test(hidden), hidden);
  check('…and marks it in the panel', await page.evaluate(`document.querySelector('.ref-item[data-ref="main"]').classList.contains('hidden-in-graph')`));
}
