// Runs end-to-end suites: `npm run test:e2e [-- <suite>...] [--no-build]`.
// Env: E2E_BINARY=<packaged executable> tests a packaged build (suites needing the main inspector are skipped);
//      E2E_HEADED=1 shows windows on the current display instead of a virtual X server (Linux).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { binary, launched, projectDir, runCleanups } from './harness.mjs';

const args = process.argv.slice(2);
const wanted = args.filter((arg) => !arg.startsWith('--'));
const suitesDir = join(projectDir, 'tests/e2e/suites');
const artifactsDir = join(projectDir, 'tests/e2e/artifacts');
const SUITE_TIMEOUT_MS = 180_000;

// Linux: run under a virtual X server so test windows never appear on (or steal focus from) the desktop.
if (process.platform === 'linux' && !process.env.E2E_HEADED && !process.env.E2E_UNDER_XVFB) {
  const hasXvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { stdio: 'ignore' }).status === 0;
  if (hasXvfb) {
    const result = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', process.execPath, ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: { ...process.env, E2E_UNDER_XVFB: '1' },
    });
    process.exit(result.status ?? 1);
  }
  if (!process.env.DISPLAY) {
    console.error('No DISPLAY and no xvfb-run: install xvfb (e.g. `apt install xvfb`) or set E2E_HEADED=1 with a display.');
    process.exit(1);
  }
  console.warn('xvfb-run not found: windows will open on the current display.');
}

if (!binary && !args.includes('--no-build')) {
  const build = spawnSync('npm', ['run', 'build', '--silent'], { cwd: projectDir, encoding: 'utf8', shell: process.platform === 'win32' });
  if (build.status !== 0) {
    console.error(build.stdout, build.stderr);
    process.exit(build.status ?? 1);
  }
  console.log('Built with electron-vite.');
}

const available = readdirSync(suitesDir).filter((file) => file.endsWith('.mjs')).map((file) => file.slice(0, -4)).sort();
const unknown = wanted.filter((name) => !available.includes(name));
if (unknown.length) {
  console.error(`Unknown suite(s): ${unknown.join(', ')}. Available: ${available.join(', ')}`);
  process.exit(1);
}
const selected = wanted.length ? available.filter((name) => wanted.includes(name)) : available;

let failedSuites = 0;
let skippedSuites = 0;
for (const name of selected) {
  const suite = await import(join(suitesDir, `${name}.mjs`));
  const meta = suite.meta ?? {};
  if (binary && meta.requiresMain) {
    console.log(`\n■ ${name} — skipped (needs the main-process inspector, unavailable in packaged builds)`);
    skippedSuites++;
    continue;
  }
  if (meta.platforms && !meta.platforms.includes(process.platform)) {
    console.log(`\n■ ${name} — skipped on ${process.platform}`);
    skippedSuites++;
    continue;
  }
  console.log(`\n■ ${name}`);
  const results = [];
  const check = (label, ok, detail = '') => {
    const line = `${ok ? 'PASS' : 'FAIL'}  ${label}${!ok || detail ? `  — ${String(detail).slice(0, 300)}` : ''}`;
    results.push({ ok: Boolean(ok), line });
    console.log(`  ${line}`);
    return Boolean(ok);
  };
  const started = Date.now();
  let timer;
  try {
    await Promise.race([
      suite.default({ check, artifactsDir }),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out after ${SUITE_TIMEOUT_MS / 1000}s`)), SUITE_TIMEOUT_MS))),
    ]);
  } catch (error) {
    check('suite completed', false, error?.stack ?? String(error));
  } finally {
    clearTimeout(timer);
  }
  if (!meta.allowConsoleProblems) {
    for (const app of launched) {
      if (!app.page) continue;
      const problems = app.page.relevantProblems();
      check('no console errors or CSP violations', problems.length === 0, problems.join(' || '));
    }
  }
  const failed = results.some((result) => !result.ok);
  if (failed) {
    failedSuites++;
    mkdirSync(artifactsDir, { recursive: true });
    for (const [index, app] of launched.entries()) {
      const file = join(artifactsDir, `${name}-${index}.png`);
      try {
        if (app.page) {
          await app.page.screenshot(file);
          console.log(`  screenshot: ${file}`);
        }
      } catch {
        // the app may already be gone
      }
      const log = app.logs.split('\n').filter((line) => line.trim() && !/dbus|Gtk-|libva|vaInitialize|Fontconfig|Debugger|For help/i.test(line));
      if (log.length) console.log(`  app log:\n    ${log.slice(-30).join('\n    ')}`);
    }
  }
  await runCleanups();
  console.log(`  ${failed ? 'failed' : 'ok'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

const ran = selected.length - skippedSuites;
console.log(`\n${ran - failedSuites}/${ran} suites passed${skippedSuites ? `, ${skippedSuites} skipped` : ''}${binary ? ` (binary: ${binary})` : ''}`);
process.exit(failedSuites ? 1 : 0);
