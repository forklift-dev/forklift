const { launchApp, runCleanups } = await import('/home/akryll/forklift/tests/e2e/harness.mjs');
const B = '/tmp/claude-1000/-home-akryll-forklift/7e493405-7f8a-4610-9bc7-63c384579a48/scratchpad/bench';
try {
  const { page } = await launchApp({ windowSize: '1600,1000' });
  await page.invoke('repo:open', `${B}/wide`);
  await page.waitFor(`[...document.querySelectorAll('.change-item')].some(b => b.textContent.includes('mid.txt'))`, 20000);
  const t = performance.now();
  await page.click(`[...document.querySelectorAll('.change-item')].find(b => b.textContent.includes('mid.txt'))`);
  const ok = await page.waitFor(`document.querySelectorAll('.monaco-editor .view-line').length > 5 || (!!document.querySelector('.diff-message') && !/Loading/.test(document.querySelector('.diff-message').textContent))`, 120000);
  console.log('shown', ok, Math.round(performance.now() - t), 'ms', await page.evaluate(`document.querySelector('.diff-message')?.textContent ?? document.querySelectorAll('.monaco-editor .view-line').length`));
  await new Promise((r) => setTimeout(r, 1500));
  const t2 = performance.now();
  const frames = await page.evaluate(`(async () => { const ed = document.querySelector('.monaco-scrollable-element'); const f = () => new Promise(r => requestAnimationFrame(r)); const ts = []; for (let i = 0; i < 20; i++) { const s = performance.now(); ed?.dispatchEvent(new WheelEvent('wheel', { deltaY: 3000, bubbles: true })); await f(); await f(); ts.push(performance.now() - s); } ts.sort((a,b)=>a-b); return { median: Math.round(ts[10]), max: Math.round(ts[19]) }; })()`);
  console.log('wheel frames', JSON.stringify(frames));
  await page.screenshot(`${B}/results/forklift-middiff.png`);
} finally { await runCleanups(); }
