// Resizable layout: the side panels by dragging or with the keyboard, hidden and shown again (Ctrl+J / Ctrl+K),
// graph columns resized in the header, columns hidden from its menu, the graph column scrolling sideways when
// its lanes do not fit, and everything kept after a restart.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { launchApp, projectDir, tempDir } from '../harness.mjs';

const CTRL = 2;
const width = (selector) => `Math.round(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width)`;
const splitter = (label) => `document.querySelector('[role="separator"][aria-label=${JSON.stringify(label)}]')`;
const menuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === ${JSON.stringify(label)})`;

export default async function ({ check }) {
  const root = join(tempDir('forklift-layout-'), 'repo');
  execFileSync(process.execPath, [join(projectDir, 'scripts/make-history-repo.mjs'), root, '300', '7']);
  const home = tempDir('forklift-home-');
  let app = await launchApp({ home });
  let { page } = app;
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.commit-row[data-hash]')`, 10000);

  const left = await page.evaluate(width('.left-panel'));
  const right = await page.evaluate(width('.side'));
  await page.drag(splitter('Resize the left panel'), 80);
  check('dragging the left border widens the left panel', await page.waitFor(`${width('.left-panel')} === ${left + 80}`), await page.evaluate(width('.left-panel')));
  await page.drag(splitter('Resize the right panel'), -60);
  check('dragging the right border widens the right panel', await page.waitFor(`${width('.side')} === ${right + 60}`), await page.evaluate(width('.side')));
  await page.evaluate(`${splitter('Resize the right panel')}.focus()`);
  await page.press('ArrowLeft', { code: 'ArrowLeft', keyCode: 37 });
  check('arrows on a focused border resize too', await page.waitFor(`${width('.side')} === ${right + 76}`));
  await page.evaluate(`${splitter('Resize the right panel')}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  check('double-click returns to the default width', await page.waitFor(`${width('.side')} === ${right}`));

  await page.press('J', { code: 'KeyJ', keyCode: 74, modifiers: CTRL });
  check('Ctrl+J hides the left panel', await page.waitFor(`!document.querySelector('.left-panel')`));
  await page.press('K', { code: 'KeyK', keyCode: 75, modifiers: CTRL });
  check('Ctrl+K hides the right panel', await page.waitFor(`document.querySelector('.side').hidden`));
  await page.press('J', { code: 'KeyJ', keyCode: 74, modifiers: CTRL });
  await page.press('K', { code: 'KeyK', keyCode: 75, modifiers: CTRL });
  check('…and both come back at their widths', await page.waitFor(`!!document.querySelector('.left-panel') && ${width('.left-panel')} === ${left + 80} && !document.querySelector('.side').hidden`));

  // Columns.
  const refs = await page.evaluate(width('.commit-header .cell.refs'));
  await page.drag(`document.querySelector('[aria-label="Resize the Branch / Tag column"]')`, 50);
  check('a column border in the header resizes the column', await page.waitFor(`${width('.commit-header .cell.refs')} === ${refs + 50} && ${width('.commit-row[data-hash] .cell.refs')} === ${refs + 50}`));
  const author = await page.evaluate(width('.commit-header .cell.author'));
  await page.drag(`document.querySelector('[aria-label="Resize the Author column"]')`, -40);
  check('columns right of the message grow to the left', await page.waitFor(`${width('.commit-header .cell.author')} === ${author + 40}`));
  await page.evaluate(`document.querySelector('.commit-header').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 120 }))`);
  await page.click(menuItem('Hide the SHA column'));
  check('the header menu hides a column', await page.waitFor(`getComputedStyle(document.querySelector('.commit-row[data-hash] .cell.sha')).display === 'none'`));

  // A narrow graph column scrolls sideways.
  const lanes = await page.evaluate(`document.querySelector('.commit-row[data-hash] .graph-cell').getAttribute('width')`);
  const graph = await page.evaluate(width('.commit-header .cell.graph'));
  await page.drag(`document.querySelector('[aria-label="Resize the Graph column"]')`, -Math.round(graph / 2));
  check('a graph column narrower than its lanes gets a sideways scrollbar', await page.waitFor(`!!document.querySelector('.graph-scrollbar')`), lanes);
  await page.drag(`document.querySelector('.graph-scrollbar-thumb')`, 40);
  check('dragging it moves the lanes', await page.waitFor(`getComputedStyle(document.querySelector('.commit-row[data-hash] .graph-cell')).transform !== 'none'`));

  // Kept after a restart.
  const before = await page.evaluate(`[${width('.left-panel')}, ${width('.commit-header .cell.refs')}, ${width('.commit-header .cell.graph')}]`);
  await app.close();
  app = await launchApp({ home });
  page = app.page;
  await page.waitFor(`!!document.querySelector('.commit-row[data-hash]')`, 10000);
  const after = await page.evaluate(`[${width('.left-panel')}, ${width('.commit-header .cell.refs')}, ${width('.commit-header .cell.graph')}, getComputedStyle(document.querySelector('.commit-row[data-hash] .cell.sha')).display]`);
  check('sizes and hidden columns survive a restart', JSON.stringify(after) === JSON.stringify([...before, 'none']), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
}
