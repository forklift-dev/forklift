const { launchApp, runCleanups } = await import('/home/akryll/forklift/tests/e2e/harness.mjs');
const repo = process.argv[2];
try {
  const { page } = await launchApp({ windowSize: '1600,1000' });
  const t = performance.now();
  await page.invoke('repo:open', repo);
  const ok = await page.waitFor(`[...document.querySelectorAll('.commit-row[data-hash] .subject')].filter(s => s.textContent).length > 10`, 120000);
  console.log(JSON.stringify({ repo, first_rows_ms: ok ? Math.round(performance.now() - t) : 'timeout' }));
} finally { await runCleanups(); }
