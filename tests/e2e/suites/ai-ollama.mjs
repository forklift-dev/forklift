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

  await page.invoke('settings:update', { values: { 'ai.provider': 'codex' } });
  await page.click(`[...document.querySelectorAll('.commit-panel .ai-assist button')].find(b => b.textContent === 'Suggest commit message')`);
  const externalDetail = await page.waitFor(`document.querySelector('.modal p')?.textContent`);
  check('CLI asks separately before any token-consuming call', /Codex/.test(externalDetail ?? '') && /paid tokens/.test(externalDetail ?? ''), externalDetail);
  await page.invoke('settings:update', { values: { 'ai.provider': 'openai' } });
  await page.click(`[...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Send to Codex')`);
  check('a provider change invalidates the earlier consent', await page.waitFor(`document.querySelector('.ai-assist [role="alert"]')?.textContent.includes('provider changed')`));

  await page.click(`document.querySelector('[aria-label="Preferences"]')`);
  await page.click(`[...document.querySelectorAll('.preferences-nav button')].find(b => b.textContent === 'Integrations')`);
  const providerSelect = `document.querySelector('[data-setting="ai.provider"] select')`;
  check('OpenAI shows its model and key', await page.waitFor(`!!document.querySelector('[data-setting="ai.openaiModel"]') && !!document.querySelector('.ai-key-editor') && !document.querySelector('[data-setting="ai.model"]')`));
  await page.selectOption(providerSelect, 'ollama');
  check('Ollama shows only its model', await page.waitFor(`!!document.querySelector('[data-setting="ai.model"]') && !document.querySelector('[data-setting="ai.openaiModel"], .ai-key-editor')`));
  for (const provider of ['claude', 'codex', 'opencode', 'qwen', 'off']) {
    await page.selectOption(providerSelect, provider);
    check(`${provider} shows no model or API key fields`, await page.waitFor(`!document.querySelector('[data-setting="ai.model"], [data-setting="ai.openaiModel"], .ai-key-editor')`));
  }
  await page.selectOption(providerSelect, 'openai');
  await page.fill(`document.querySelector('.preferences-search')`, 'API key');
  check('search finds the OpenAI key editor when OpenAI is selected', await page.waitFor(`!!document.querySelector('.ai-key-editor') && !document.querySelector('.empty-note')`));
}
