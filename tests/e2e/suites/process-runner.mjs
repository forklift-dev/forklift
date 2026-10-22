// ProcessRunner inside a real Electron main process, driven over the Node inspector.
import { execFileSync } from 'node:child_process';
import { inMain, launchApp, processesMatching, sleep } from '../harness.mjs';

export const meta = { requiresMain: true, platforms: ['linux', 'darwin'] };

export default async function ({ check }) {
  const app = await launchApp({ inspect: true, page: false });
  const r = (code) => inMain(app, code);

  const version = await app.main.waitFor(`globalThis.forkliftDebug.store.getState().app.gitCli?.version`);
  check('git version detected at startup', /^\d+\.\d+\.\d+$/.test(version ?? ''), version);

  const hosts = execFileSync('ps', ['-eo', 'ppid=,args=']).toString().split('\n')
    .filter((line) => line.includes('--utility-sub-type=node.mojom.NodeService') && Number(line.trim().split(/\s+/)[0]) === app.child.pid);
  check('exactly one process host (utilityProcess)', hosts.length === 1, `${hosts.length}`);

  const run = JSON.parse(await r(`return JSON.stringify(await runner.run('git', ['--version']))`));
  check('run git --version', run.code === 0 && run.stdout.startsWith('git version'), run.stdout.trim());

  const env = JSON.parse(await r(`const res = await runner.run('env', []); return JSON.stringify(res.stdout.split('\\n').filter(l => /^(ELECTRON_|NODE_OPTIONS)/.test(l)))`));
  check('child env has no ELECTRON_*/NODE_OPTIONS', env.length === 0, JSON.stringify(env));

  const streamed = await r(`const parts = []; await runner.run('sh', ['-c', 'echo one; sleep 0.1; echo two'], { onStdout: t => parts.push(t) }); return parts.join('|')`);
  check('streams stdout', streamed.includes('one') && streamed.includes('two'), JSON.stringify(streamed));

  const aborted = await r(`
    const controller = new AbortController();
    const started = Date.now();
    const promise = runner.run('sleep', ['31'], { signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    try { await promise; return 'resolved'; } catch (e) { return e.name + ' after ' + (Date.now() - started) + 'ms'; }`);
  check('AbortSignal cancels a running command', /^AbortError after \d+ms$/.test(aborted) && Number(aborted.match(/(\d+)ms/)[1]) < 3000, aborted);
  await sleep(300);
  check('cancelled process is gone', processesMatching('sleep 31').length === 0);

  const timeout = JSON.parse(await r(`return JSON.stringify(await runner.run('sleep', ['32'], { timeoutMs: 200 }))`));
  check('timeout terminates', timeout.timedOut === true, `signal ${timeout.signal}`);

  const missing = await r(`try { await runner.run('forklift-missing-tool', []); return 'resolved'; } catch (e) { return e.name + ':' + e.code; }`);
  check('missing executable → ProcessError ENOENT', missing === 'ProcessError:ENOENT', missing);

  const waited = JSON.parse(await r(`return JSON.stringify(await runner.launch('sh', ['-c', 'exit 5'], { wait: true }))`));
  check('launch wait: true returns exit code', waited.code === 5, JSON.stringify(waited));

  const detached = JSON.parse(await r(`return JSON.stringify(await runner.launch('sleep', ['7']))`));
  check('launch detached returns pid', detached.pid > 0 && detached.code === null, JSON.stringify(detached));

  // Kill the host: pending calls fail fast, the next call starts a fresh host, no orphans remain.
  const crash = await r(`
    const pending = runner.run('sleep', ['33']).then(() => 'resolved', e => e.message);
    await new Promise(r => setTimeout(r, 200));
    runner.host.kill();
    const outcome = await pending;
    const after = await runner.run('git', ['--version']);
    return outcome + ' | next call code ' + after.code;`);
  check('host crash rejects pending and restarts', crash.includes('exited unexpectedly') && crash.endsWith('next call code 0'), crash);
  await sleep(300);
  check('no orphans after host crash', processesMatching('sleep 33').length === 0);

  const viaCli = await r(`
    const ok = await gitCli.exec(['--version'], { cwd: '/' });
    const err = await gitCli.exec(['-C', '/', 'status'], { cwd: '/' }).then(() => 'resolved', e => e.name + ' ' + e.exitCode + ' ' + e.message);
    return ok.stdout.trim() + ' | ' + err;`);
  check('GitCli through live ProcessRunner', /^git version .* \| GitCliError 128 git -C \/ status failed: fatal: not a git repository/.test(viaCli), viaCli);

  // A detached launch outlives the app.
  await app.close();
  await sleep(500);
  const survivors = processesMatching('sleep 7');
  check('detached program survives app exit', survivors.length === 1, survivors.join(';'));
  try {
    process.kill(detached.pid);
  } catch {
    // already gone
  }
}
