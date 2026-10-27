// AI stays off by default and asks before any repository content reaches Ollama.
import { createRepo, launchApp } from '../harness.mjs';

export default async function ({ check }) {
  const { root, git, write } = createRepo();
  write('a.txt', 'before\n');
  git('add', 'a.txt');
  git('commit', '-qm', 'Base');
  write('a.txt', 'after\n');
  git('add', 'a.txt');

  const { page } = await launchApp();
  await page.invoke('repo:open', root);
  await page.waitFor(`!!document.querySelector('.commit-panel')`);
  check('AI controls are hidden until enabled', (await page.evaluate(`document.querySelectorAll('.commit-panel .ai-assist').length`)) === 0);

  await page.invoke('settings:update', { values: { 'ai.provider': 'ollama', 'ai.model': 'test-model' } });
  check('the commit panel offers AI after opt-in', await page.waitFor(`!![...document.querySelectorAll('.commit-panel .ai-assist button')].find(b => b.textContent === 'Suggest commit message')`));
  await page.click(`[...document.querySelectorAll('.commit-panel .ai-assist button')].find(b => b.textContent === 'Suggest commit message')`);
  const detail = await page.waitFor(`document.querySelector('.modal p')?.textContent`);
  check('each request asks for consent and explains token costs', /Allow local Ollama/.test(detail ?? '') && /paid API tokens/.test(detail ?? ''), detail);
  check('Cancel is the focused default', await page.evaluate(`document.activeElement?.textContent === 'Cancel'`));
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Cancel')`);
  check('cancel sends no request or changes', await page.waitFor(`!document.querySelector('.modal') && !document.querySelector('.ai-result') && ![...document.querySelectorAll('.ai-assist button')].some(b => b.textContent === 'Asking Ollama…')`));
}
