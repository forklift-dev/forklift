import { createRepo, launchApp } from '../harness.mjs';

const row = (subject) => `[...document.querySelectorAll('.commit-row[data-hash]')].find(r => r.querySelector('.subject')?.textContent.endsWith(${JSON.stringify(subject)}))`;
const menuItem = (label) => `[...document.querySelectorAll('.context-menu button')].find(b => b.textContent.startsWith(${JSON.stringify(label)}))`;
async function mark(page, subject, label) {
  await page.waitFor(`!!${row(subject)}`);
  await page.evaluate(`(() => { const el = ${row(subject)}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 300, clientY: r.y + 8 })); })()`);
  await page.waitFor(`!!${menuItem(label)}`);
  await page.click(menuItem(label));
}

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  for (let i = 0; i < 7; i++) {
    write('version.txt', `${i}\n`);
    git('add', '.');
    git('commit', '-qm', `Version ${i}`);
  }
  const culprit = git('rev-parse', 'HEAD~3');
  const { page } = await launchApp();
  await page.invoke('repo:open', root);

  await mark(page, 'Version 6', 'Mark bad for bisect');
  check('bad mark opens the bisect banner', await page.waitFor(`document.querySelector('.bisect-banner')?.textContent.includes('mark a good and a bad')`));
  await mark(page, 'Version 0', 'Mark good for bisect');
  check('good and bad marks appear in the graph', await page.waitFor(`!!${row('Version 6')}?.querySelector('.bisect-badge.bad') && !!${row('Version 0')}?.querySelector('.bisect-badge.good')`));
  check('banner shows candidates and remaining checks', /candidates/.test(await page.waitFor(`document.querySelector('.bisect-banner')?.textContent`) ?? ''));
  await page.evaluate(`(() => { const el = ${row('Version 6')}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 300, clientY: r.y + 8 })); })()`);
  check('checkout is disabled while bisect owns HEAD', await page.waitFor(`!!${menuItem('Check out this commit')}?.disabled`));
  const firstHead = git('rev-parse', 'HEAD');
  await page.click(`[...document.querySelectorAll('.bisect-banner button')].find(b => b.textContent === 'Bad')`);
  check('manual mark advances to another commit', await page.waitFor(`document.querySelector('.bisect-banner')?.textContent.includes('step 2')`) && git('rev-parse', 'HEAD') !== firstHead);

  await page.click(`[...document.querySelectorAll('.bisect-banner button')].find(b => b.textContent === 'End bisect')`);
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'End bisect')`);
  check('reset restores main', await page.waitFor(`!document.querySelector('.bisect-banner')`) && git('branch', '--show-current') === 'main');

  await mark(page, 'Version 6', 'Mark bad for bisect');
  await mark(page, 'Version 0', 'Mark good for bisect');
  await page.invoke('bisect:run', root, process.execPath, ['-e', "process.exit(Number(require('fs').readFileSync('version.txt','utf8')) >= 3 ? 1 : 0)"]);
  check('script finds the first bad commit', await page.waitFor(`document.querySelector('.bisect-banner')?.textContent.includes('First bad commit')`) && git('rev-parse', 'refs/bisect/bad') === culprit);
  check('script output is visible', Boolean(await page.waitFor(`document.querySelector('.bisect-output')?.textContent.includes('bisect')`)));
}
