// Hooks: a slow pre-commit hook shows that it runs and what it prints, its failure explains itself,
// "Skip hooks" commits with --no-verify, and hooks in core.hooksPath count too.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, tempDir } from '../harness.mjs';

export const meta = { platforms: ['linux', 'darwin'] };

const commitButton = `[...document.querySelectorAll('.commit-panel button[type="submit"]')][0]`;

export default async function ({ check }) {
  const { root, git, write } = createRepo({ dir: join(tempDir('forklift-hooks-'), 'repo') });
  write('a.txt', 'a\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  const hooks = join(root, '.githooks');
  mkdirSync(hooks);
  // Prints, waits a little (so the window can show it running), then fails.
  writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\necho "checking style…"\nsleep 1.5\necho "lint failed: a.txt" >&2\nexit 1\n');
  chmodSync(join(hooks, 'pre-commit'), 0o755);
  git('config', 'core.hooksPath', '.githooks');
  write('a.txt', 'b\n');
  git('add', 'a.txt');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  check('"Skip hooks" is offered when a hook would check the commit (core.hooksPath)', await page.waitFor(`!!document.querySelector('.commit-panel [name="skipHooks"]')`, 5000));
  await page.fill(`document.querySelector('.commit-summary')`, 'Change a');
  await page.waitFor(`!${commitButton}.disabled`);
  await page.click(commitButton);
  const running = await page.waitFor(`document.querySelector('.hook-activity')?.textContent`, 5000);
  check('the running hook is shown with its output', /Running pre-commit hook/.test(running ?? ''), running);
  check('its output appears while it runs', await page.waitFor(`/checking style/.test(document.querySelector('.hook-output')?.textContent ?? '')`, 3000));
  const failure = await page.waitFor(`document.querySelector('.error-banner:not(.notices)')?.textContent`, 10000);
  check('a failing hook explains the failure', /Commit failed:[\s\S]*lint failed: a\.txt/.test(failure ?? ''), failure);
  check('the indicator goes away', await page.waitFor(`!document.querySelector('.hook-activity')`));
  check('nothing was committed', git('log', '-1', '--format=%s') === 'init');

  await page.click(`document.querySelector('.commit-panel [name="skipHooks"]')`);
  await page.click(commitButton);
  check('"Skip hooks" commits without running it', await page.waitFor(`document.querySelector('.commit-row[data-hash] .subject')?.textContent === 'Change a'`, 10000) && git('log', '-1', '--format=%s') === 'Change a');
  check('the choice does not stick', await page.waitFor(`document.querySelector('.commit-panel [name="skipHooks"]')?.checked === false`));
}
