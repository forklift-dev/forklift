// External diff/merge buttons with fake tools configured in the repository; the tool choice without config.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { binary, createRepo, inMain, launchApp, sleep } from '../harness.mjs';

export const meta = { platforms: ['linux', 'darwin'] };

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('f.txt', 'base\n');
  write('other.txt', 'other\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'theirs');
  write('f.txt', 'theirs\n');
  git('commit', '-qam', 'theirs');
  git('checkout', '-q', 'main');
  write('f.txt', 'ours\n');
  git('commit', '-qam', 'ours');
  git.allowFail('merge', 'theirs'); // conflict in f.txt
  write('other.txt', 'other changed\n');
  const diffOut = join(root, '.git', 'diff.out');
  git('config', 'diff.tool', 'fake');
  git('config', 'difftool.fake.cmd', `cat "$LOCAL" "$REMOTE" > "${diffOut}"; sleep 2`);
  git('config', 'merge.tool', 'fake');
  git('config', 'mergetool.fake.cmd', 'cp "$REMOTE" "$MERGED"');
  git('config', 'mergetool.fake.trustExitCode', 'true');
  git('config', 'mergetool.keepBackup', 'false');

  // The tool choice is only reachable through the main-process inspector, which packaged builds lack.
  const app = await launchApp({ inspect: !binary });
  const { page } = app;

  if (app.main) {
    // Without any configuration some GUI tool (or VS Code) is chosen, or none is available here.
    const plain = createRepo();
    const choice = await inMain(app, `
      const d = await diffTools.pickTool(${JSON.stringify(plain.root)}, 'diff').catch(e => ({ source: 'none', name: e.message }));
      const m = await diffTools.pickTool(${JSON.stringify(plain.root)}, 'merge').catch(e => ({ source: 'none', name: e.message }));
      return d.source + ':' + d.name + ' / ' + m.source + ':' + m.name;`);
    check('tool choice without config is detected or explained', /^(detected|vscode|none):\S/.test(choice ?? ''), choice);
  }

  check('repo with conflict opened', (await page.invoke('repo:open', root))?.ok === true);
  await page.waitFor(`!!document.querySelector('.change-row')`);
  const rowsText = () => page.evaluate(`[...document.querySelectorAll('.change-row')].map(r => r.textContent.trim()).join(' | ')`);
  const actionsOf = (name) => page.evaluate(`[...[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('${name}'))?.querySelectorAll('[aria-label]') ?? []].map(b => b.getAttribute('aria-label')).join(',')`);
  const conflictActions = await actionsOf('f.txt');
  const modifiedActions = await actionsOf('other.txt');
  check('conflicted file offers external merge, modified file external diff',
    /!f\.txt/.test(await rowsText()) && conflictActions.includes('Resolve in external merge tool') && modifiedActions.includes('Open in external diff tool'),
    `${conflictActions} | ${modifiedActions}`);

  await page.evaluate(`[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('other.txt')).querySelector('[title="Open in external diff tool"]').click()`);
  await sleep(700); // the fake tool stays "open" for 2 s
  const refreshEnabled = await page.evaluate(`!([...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Refresh').disabled)`);
  check('UI stays usable while the diff tool is open', refreshEnabled === true);
  const again = await page.invoke('file:externalDiff', 'other.txt', false);
  check('second diff of the same file refused', /already open/.test(JSON.stringify(again)), JSON.stringify(again));
  for (let i = 0; i < 60 && !existsSync(diffOut); i++) await sleep(100);
  const diffText = existsSync(diffOut) ? readFileSync(diffOut, 'utf8') : 'no output';
  check('diff tool got index and worktree versions', diffText === 'other\nother changed\n', JSON.stringify(diffText));

  await page.evaluate(`[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('f.txt')).querySelector('[title="Resolve in external merge tool"]').click()`);
  const after = await page.waitFor(`(() => { const t = [...document.querySelectorAll('.change-row')].map(r => r.textContent.trim()).join(' | '); return !t.includes('!f.txt') && t; })()`, 10000);
  check('after Merge the conflict is gone and the file is staged', after && /Mf\.txt/.test(after), after || (await rowsText()));
  check('merged content taken from the tool', readFileSync(join(root, 'f.txt'), 'utf8') === 'theirs\n');
  const banner = await page.evaluate(`document.querySelector('.error-banner')?.textContent ?? ''`);
  check('no error shown', banner === '', banner);
}
