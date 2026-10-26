// Forklift on big repositories, measured through the DevTools protocol (packaged build via E2E_BINARY).
import { readdirSync, readFileSync } from 'node:fs';

const { launchApp, runCleanups } = await import('/home/akryll/forklift/tests/e2e/harness.mjs');
const B = '/tmp/claude-1000/-home-akryll-forklift/7e493405-7f8a-4610-9bc7-63c384579a48/scratchpad/bench';
const rows = `document.querySelectorAll('.commit-row[data-hash]')`;
const now = () => performance.now();
const results = {};

function treePss(rootPid) {
  const children = new Map();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const ppid = Number(readFileSync(`/proc/${entry}/stat`, 'utf8').split(') ')[1].split(' ')[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(entry));
    } catch {}
  }
  let kib = 0;
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    try {
      kib += Number(/Pss:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))[1]);
    } catch {}
    stack.push(...(children.get(pid) ?? []));
  }
  return Math.round(kib / 1024);
}

/** ms until the expression holds, checked every animation frame. */
async function until(page, expression, timeout = 120000) {
  const started = now();
  const ok = await page.waitFor(expression, timeout);
  return ok ? Math.round(now() - started) : null;
}

async function historyRepo(name, root, oldestSubject) {
  const app = await launchApp({ windowSize: '1600,1000' });
  const { page } = app;
  const t0 = now();
  await page.invoke('repo:open', root);
  const opened = Math.round(now() - t0);
  const firstRows = await until(page, `${rows}.length > 10`);
  const r = { open_ipc_ms: opened, first_rows_ms: firstRows + opened };
  // To the end of the history: the graph learns its length as it reads on.
  const t1 = now();
  let found = false;
  while (now() - t1 < 600000) {
    await page.evaluate(`document.querySelector('.commit-scroll').scrollTop = 1e12`);
    if (await page.evaluate(`[...${rows}].some(r => r.textContent.includes(${JSON.stringify(oldestSubject)}))`)) {
      found = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  r.scroll_to_oldest_ms = found ? Math.round(now() - t1) : 'timeout';
  r.rows_total = await page.evaluate(`Math.round(document.querySelector('.commit-scroll').scrollHeight / (document.querySelector('.commit-row[data-hash]')?.offsetHeight || 1))`);
  // Random jumps over the loaded history: frames until the rows at the new position are drawn.
  const jumps = await page.evaluate(`(async () => {
    const scroller = document.querySelector('.commit-scroll');
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const times = [];
    for (let i = 0; i < 30; i++) {
      const top = Math.floor(Math.random() * (scroller.scrollHeight - scroller.clientHeight));
      const started = performance.now();
      scroller.scrollTop = top;
      let frames = 0;
      for (;;) {
        await frame();
        frames++;
        const first = scroller.querySelector('.commit-row[data-hash]');
        const rect = first && first.getBoundingClientRect();
        const box = scroller.getBoundingClientRect();
        const visible = [...scroller.querySelectorAll('.commit-row[data-hash]')].filter((row) => { const b = row.getBoundingClientRect(); return b.bottom > box.top && b.top < box.bottom; });
        if (visible.length > 10 && visible.every((row) => row.querySelector('.subject')?.textContent)) break;
        if (frames > 600) break;
      }
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    return { median_ms: Math.round(times[15]), p95_ms: Math.round(times[28]), max_ms: Math.round(times[29]) };
  })()`);
  r.jump = jumps;
  r.pss_mib = treePss(app.child.pid);
  results[name] = r;
  await app.close();
}

async function wideRepo() {
  const root = `${B}/wide`;
  const app = await launchApp({ windowSize: '1600,1000' });
  const { page } = app;
  const t0 = now();
  await page.invoke('repo:open', root);
  const opened = Math.round(now() - t0);
  const changes = await until(page, `document.querySelectorAll('.change-row, .change-item').length >= 100`);
  const r = { open_ipc_ms: opened, changes_listed_ms: changes === null ? null : changes + opened };
  const refresh = [];
  for (let i = 0; i < 5; i++) {
    const t = now();
    await page.invoke('repo:refresh', root);
    refresh.push(Math.round(now() - t));
  }
  refresh.sort((a, b) => a - b);
  r.refresh_ms = { median: refresh[2], max: refresh[4] };
  // The 20 MB file's diff: IPC, then the editor showing lines.
  const t1 = now();
  const diff = await page.invoke('diff:file', root, { kind: 'worktree', path: 'big.txt', staged: false });
  r.diff_ipc_ms = Math.round(now() - t1);
  r.diff_ok = diff?.ok === true;
  await page.click(`[...document.querySelectorAll('.change-item')].find(b => b.textContent.includes('big.txt'))`);
  const shown = await until(page, `document.querySelectorAll('.monaco-editor .view-line').length > 10`);
  r.diff_click_to_lines_ms = shown;
  r.pss_mib = treePss(app.child.pid);
  results.wide = r;
  await app.close();
}

try {
  // await historyRepo('git', `${B}/git`, 'Initial revision of "git", the information manager from hell');
  await historyRepo('linux', `${B}/linux-hist`, 'Linux-2.6.12-rc2');
  // await wideRepo();
} catch (error) {
  results.error = String(error?.stack ?? error);
} finally {
  await runCleanups();
}
console.log(JSON.stringify(results, null, 2));
