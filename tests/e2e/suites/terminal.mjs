// The embedded terminal: a shell in the repository's folder, typing and output, several terminals,
// terminals kept per repository tab, closing ends the shell.
import { createRepo, launchApp, processesMatching, sleep } from '../harness.mjs';

export const meta = { platforms: ['linux', 'darwin'] };

const screen = `[...document.querySelectorAll('.terminal-dock:not([hidden]) .terminal-view:not([hidden]) .xterm-rows > div')].map(r => r.textContent).join('\\n')`;

async function type(page, text) {
  await page.evaluate(`document.querySelector('.terminal-dock:not([hidden]) .terminal-view:not([hidden]) textarea').focus()`);
  await page.insertText(text);
  await page.press('Enter');
}

export default async function ({ check }) {
  const a = createRepo({ prefix: 'forklift-term-a-' });
  a.write('a.txt', 'a\n');
  a.git('add', '.');
  a.git('commit', '-qm', 'a');
  const b = createRepo({ prefix: 'forklift-term-b-' });
  b.write('b.txt', 'b\n');
  b.git('add', '.');
  b.git('commit', '-qm', 'b');

  // A plain predictable shell: no user rc files, a fixed prompt.
  const { page } = await launchApp({ env: { SHELL: '/bin/sh', PS1: '$ ', ENV: '' } });
  await page.invoke('repo:open', a.root);
  await page.click(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Terminal')`);
  check('the terminal panel opens', await page.waitFor(`!!document.querySelector('.terminal-dock:not([hidden]) .xterm')`));
  await page.waitFor(`/\\$/.test(${screen})`, 10000);
  await type(page, 'pwd; echo answer=$((6*7))');
  const output = await page.waitFor(`/answer=42/.test(${screen}) && ${screen}`, 10000);
  check('the shell runs in the repository folder', output.includes(a.root), output);
  check('typing and output work', /answer=42/.test(output));

  // A second terminal in the same repository.
  await page.click(`document.querySelector('.terminal-dock:not([hidden]) [aria-label="New terminal"]')`);
  await page.waitFor(`document.querySelectorAll('.terminal-dock:not([hidden]) .terminal-tab').length === 2`);
  await page.waitFor(`/\\$/.test(${screen})`, 10000);
  await type(page, 'echo second-$((1+1))');
  check('a second terminal is independent', await page.waitFor(`/second-2/.test(${screen}) && !/answer=42/.test(${screen})`, 10000));

  // Another repository has its own terminals; the first one keeps its shells.
  await page.invoke('repo:open', b.root);
  check('the other tab has no terminal until one is opened', await page.waitFor(`!document.querySelector('.terminal-dock:not([hidden])')`));
  await page.click(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Terminal')`);
  await page.waitFor(`/\\$/.test(${screen})`, 10000);
  await type(page, 'pwd');
  check('a terminal of the other repository starts in its folder', await page.waitFor(`${screen}.includes(${JSON.stringify(b.root)})`, 10000));
  await page.invoke('repo:activate', a.root);
  check('switching back shows the first repository’s terminals', await page.waitFor(`document.querySelectorAll('.terminal-dock:not([hidden]) .terminal-tab').length === 2`));

  // Closing a terminal ends its shell.
  await type(page, 'sleep 471');
  await sleep(500);
  check('a command is running', processesMatching('sleep 471').length === 1);
  await page.click(`[...document.querySelectorAll('.terminal-dock:not([hidden]) .terminal-tab')].find(t => t.classList.contains('active')).querySelector('button')`);
  await sleep(800);
  check('closing the terminal ends its shell and command', processesMatching('sleep 471').length === 0);

  await page.press('`', { code: 'Backquote', keyCode: 192, modifiers: 2 });
  check('Ctrl+` hides the panel', await page.waitFor(`!document.querySelector('.terminal-dock:not([hidden])')`));
}
