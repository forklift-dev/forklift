// Toolbar and row buttons launch the external terminal and editor with the right cwd and arguments.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, sleep, tempDir } from '../harness.mjs';

export const meta = { platforms: ['linux'] };

async function recorded(file) {
  for (let i = 0; i < 100 && !existsSync(file); i++) await sleep(50);
  return existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n') : null;
}

export default async function ({ check }) {
  const work = tempDir('forklift-tools-');
  const bin = join(work, 'bin');
  mkdirSync(bin);
  const recorder = (out) => `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "${out}"\n`;
  writeFileSync(join(bin, 'code'), recorder(join(work, 'editor.out')), { mode: 0o755 });
  writeFileSync(join(bin, 'fake-term'), recorder(join(work, 'term.out')), { mode: 0o755 });

  const { root, git, write } = createRepo({ dir: join(work, 'repo') });
  write('src/a b.ts', 'one\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  write('src/a b.ts', 'two\n');

  const { page } = await launchApp({ env: { PATH: `${bin}:/usr/bin:/bin`, TERMINAL: 'fake-term' } });
  check('repo opened', (await page.invoke('repo:open', root))?.ok === true);
  await page.waitFor(`!!document.querySelector('.change-row')`);

  await page.evaluate(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Terminal').click()`);
  const term = await recorded(join(work, 'term.out'));
  check('Terminal button → $TERMINAL in repo root', term?.[0] === root && term.length === 1, JSON.stringify(term));

  await page.evaluate(`[...document.querySelectorAll('.change-row')].find(r => r.textContent.includes('a b.ts')).querySelector('[title="Open in editor"]').click()`);
  const editor = await recorded(join(work, 'editor.out'));
  check('Edit on changed file → code --goto file:1', JSON.stringify(editor) === JSON.stringify([root, '--goto', `${join(root, 'src', 'a b.ts')}:1`]), JSON.stringify(editor));

  const traversal = await page.invoke('file:openInEditor', '../bin/code');
  check('path outside repo rejected', traversal?.ok === false && /outside the repository/.test(traversal.error?.message), JSON.stringify(traversal));
  const badLine = await page.invoke('file:openInEditor', 'src/a b.ts', -3);
  check('invalid line rejected', /line must be a positive integer/.test(badLine?.error?.message ?? ''), JSON.stringify(badLine));

  await page.invoke('repo:close');
  const noRepo = await page.invoke('repo:openTerminal');
  check('terminal without open repo rejected', /No repository is open/.test(noRepo?.error?.message ?? ''), JSON.stringify(noRepo));
}
