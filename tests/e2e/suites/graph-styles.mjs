// Graph styles: each one draws what it promises (avatar nodes and lane-colored labels in Kraken, stations in
// Metro, row heights), the choice in Preferences applies at once, selection and "go to" still work, and a
// screenshot of every style in every theme goes to tests/e2e/artifacts/graph-styles for choosing one.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, projectDir, tempDir } from '../harness.mjs';

const STYLES = { kraken: 30, classic: 28, compact: 22, metro: 30 };
const THEMES = ['forklift-dark', 'forklift-light', 'dark-high-contrast', 'light-high-contrast', 'polar', 'sand'];
const commits = `document.querySelector('.commits')`;

export default async function ({ check }) {
  const root = join(tempDir('forklift-graph-styles-'), 'repo');
  execFileSync(process.execPath, [join(projectDir, 'scripts/make-history-repo.mjs'), root, '400', '5']);
  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.commit-row[data-hash]')`, 10000);

  check('Kraken is the default style', await page.evaluate(`${commits}.classList.contains('graph-style-kraken')`));
  check('Kraken: commits are avatar nodes in a ring, merges are dots', await page.evaluate(`!!document.querySelector('.graph-cell .avatar-node .node-ring') && !!document.querySelector('.graph-cell .node.merge')`));
  check('Kraken: lane-colored labels with a line to the node, and a streak along the row', await page.evaluate(`${commits}.classList.contains('lane-refs') && !!document.querySelector('.cell.refs.has-refs') && !!document.querySelector('.graph-cell .ref-connector') && !!document.querySelector('.graph-cell .streak')`));
  check('Kraken: turns are straight runs with rounded corners', await page.evaluate(`[...document.querySelectorAll('.graph-cell .edge')].some(p => /Q/.test(p.getAttribute('d')))`));

  for (const [style, height] of Object.entries(STYLES)) {
    await page.invoke('settings:update', { values: { 'ui.graphStyle': style } });
    await page.waitFor(`${commits}.classList.contains('graph-style-${style}')`);
    const rowHeight = await page.evaluate(`document.querySelector('.commit-row[data-hash]').getBoundingClientRect().height`);
    check(`${style}: rows are ${height} px`, Math.round(rowHeight) === height, rowHeight);
  }
  check('Metro: stations and 45° turns', await page.evaluate(`!!document.querySelector('.graph-cell .node.station') && [...document.querySelectorAll('.graph-cell .edge')].some(p => /L/.test(p.getAttribute('d')))`));
  check('Compact: plain dots, no avatars', await page.invoke('settings:update', { values: { 'ui.graphStyle': 'compact' } }).then(() => page.waitFor(`${commits}.classList.contains('graph-style-compact') && !document.querySelector('.graph-cell .avatar-node')`)));

  // Selection and going to a commit far down work with another row height.
  const target = execFileSync('git', ['rev-list', '--all', '--date-order', '--skip=300', '-1'], { cwd: root }).toString().trim();
  await page.invoke('settings:update', { values: { 'ui.graphStyle': 'kraken' } });
  await page.waitFor(`${commits}.classList.contains('graph-style-kraken')`);
  await page.press('P', { code: 'KeyP', keyCode: 80, modifiers: 2 });
  await page.insertText(target.slice(0, 10));
  await page.waitFor(`document.querySelector('.palette-item.active')?.textContent.includes(${JSON.stringify(target.slice(0, 7))})`, 10000);
  await page.press('Enter');
  check('a commit far down is scrolled to and selected', await page.waitFor(`document.querySelector('.commit-row.selected')?.dataset.hash === ${JSON.stringify(target)} && (() => { const r = document.querySelector('.commit-row.selected').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`, 10000));

  // In Preferences: cards, applied at once.
  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'UI')`);
  await page.click(`document.querySelector('[data-graph-style="metro"]')`);
  check('picking a card in Preferences switches the style', await page.waitFor(`${commits}.classList.contains('graph-style-metro')`));
  await page.press('Escape');

  const shots = join(projectDir, 'tests/e2e/artifacts/graph-styles');
  mkdirSync(shots, { recursive: true });
  await page.evaluate(`document.querySelector('.commit-scroll').scrollTop = 0`);
  for (const theme of THEMES) {
    for (const style of Object.keys(STYLES)) {
      await page.invoke('settings:update', { values: { 'ui.theme': theme, 'ui.graphStyle': style } });
      await page.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme)} && ${commits}.classList.contains('graph-style-${style}')`);
      await page.screenshot(join(shots, `${style}-${theme}.png`));
    }
  }
  check('screenshots of every style in every theme', true);
}
