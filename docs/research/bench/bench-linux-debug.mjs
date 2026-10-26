import { readdirSync, readFileSync } from 'node:fs';
const { launchApp, runCleanups } = await import('/home/akryll/forklift/tests/e2e/harness.mjs');
const B = '/tmp/claude-1000/-home-akryll-forklift/7e493405-7f8a-4610-9bc7-63c384579a48/scratchpad/bench';
function procs(rootPid) {
  const children = new Map(); const info = new Map();
  for (const e of readdirSync('/proc')) { if (!/^\d+$/.test(e)) continue; try { const st = readFileSync(`/proc/${e}/stat`, 'utf8'); const ppid = Number(st.split(') ')[1].split(' ')[1]); (children.get(ppid) ?? children.set(ppid, []).get(ppid)).push(Number(e)); info.set(Number(e), (/--type=([a-z-]+)/.exec(readFileSync(`/proc/${e}/cmdline`, 'utf8')) ?? [0, 'main'])[1] + (/--utility-sub-type=([a-zA-Z.]+)/.exec(readFileSync(`/proc/${e}/cmdline`, 'utf8')) ?? [0, ''])[1]); } catch {} }
  const out = []; const stack = [rootPid];
  while (stack.length) { const pid = stack.pop(); try { out.push([info.get(pid), Math.round(Number(/Pss:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))[1]) / 1024)]); } catch {} stack.push(...(children.get(pid) ?? [])); }
  return out;
}
const app = await launchApp({ windowSize: '1600,1000' });
try {
  const t0 = performance.now();
  void app.page.invoke('repo:open', `${B}/linux-hist`).then((r) => console.log('open', Math.round(performance.now() - t0), JSON.stringify(r).slice(0, 200)));
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const alive = app.child.exitCode === null;
    let rows = null;
    try { rows = await app.page.evaluate(`document.querySelectorAll('.commit-row[data-hash]').length`); } catch (e) { rows = 'ERR'; }
    console.log(`t=${(i + 1) * 2}s alive=${alive} rows=${rows} pss=${JSON.stringify(procs(app.child.pid))}`);
    if (!alive || rows === 'ERR') break;
    if (rows > 10) {
      try { await app.page.evaluate(`document.querySelector('.commit-scroll').scrollTop = 1e12`); } catch {}
    }
  }
} finally {
  console.log('--- logs'); console.log(app.logs.split('\n').filter(l => !/DevTools listening/.test(l)).slice(-40).join('\n'));
  await runCleanups();
}
