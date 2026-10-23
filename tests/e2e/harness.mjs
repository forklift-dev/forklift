// Shared plumbing for end-to-end suites: launches the app in an isolated profile and drives it over CDP.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectDir = fileURLToPath(new URL('../..', import.meta.url));
/** Packaged builds lock `--inspect` with fuses, so suites that need the main process skip them. */
export const binary = process.env.E2E_BINARY || null;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanups = [];
/** Apps started by the current suite; the runner screenshots them on failure and checks their consoles. */
export const launched = [];
/** Registers work to run after the current suite, whatever its outcome (LIFO). */
export function defer(fn) {
  cleanups.push(fn);
}
export async function runCleanups() {
  launched.length = 0;
  while (cleanups.length) {
    try {
      await cleanups.pop()();
    } catch (error) {
      console.error('cleanup failed:', error);
    }
  }
}

/** A fresh directory (realpath, so it matches paths the app reports) removed after the suite. */
export function tempDir(prefix = 'forklift-e2e-') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  defer(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Ada',
  GIT_AUTHOR_EMAIL: 'ada@example.com',
  GIT_COMMITTER_NAME: 'Ada',
  GIT_COMMITTER_EMAIL: 'ada@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
};

/** Creates a repository on `main` with a local identity; `git(...)` runs in it and returns trimmed stdout. */
export function createRepo({ prefix = 'forklift-repo-', dir } = {}) {
  const root = dir ?? tempDir(prefix);
  mkdirSync(root, { recursive: true });
  const env = { ...process.env, ...GIT_IDENTITY, HOME: root };
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: root, env, stdio: 'pipe' }).toString().replace(/\n$/, '');
    } catch (error) {
      // Say why: git's own message, not just "Command failed".
      if (error.stderr?.length) error.message = `${error.message}\n${error.stderr.toString().trim()}`;
      throw error;
    }
  };
  /** Like git(), but a non-zero exit (e.g. a conflicting merge) is not an error. */
  git.allowFail = (...args) => {
    try {
      return git(...args);
    } catch (error) {
      return error.stdout?.toString() ?? '';
    }
  };
  git('init', '-q', '--initial-branch=main');
  git('config', 'user.name', GIT_IDENTITY.GIT_AUTHOR_NAME);
  git('config', 'user.email', GIT_IDENTITY.GIT_AUTHOR_EMAIL);
  git('config', 'commit.gpgsign', 'false');
  const write = (path, content) => {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  };
  return { root, git, write };
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function electronBinary() {
  if (binary) return binary;
  return (await import(join(projectDir, 'node_modules/electron/index.js'))).default;
}

/**
 * Launches the app with its own HOME and XDG_CONFIG_HOME (pass `home` again to restart with the same profile): the single-instance lock and settings
 * never touch a copy the developer has running. `env` entries override, `undefined` removes.
 * `baseEnv: 'minimal'` starts from DISPLAY only (a desktop-menu launch); default inherits process.env.
 */
export async function launchApp({ env = {}, baseEnv = 'inherit', inspect = false, page = true, args = [], windowSize = '1400,900', home = tempDir('forklift-home-') } = {}) {
  if (inspect && binary) throw new Error('the main-process inspector is fused off in packaged builds');
  const display = { DISPLAY: process.env.DISPLAY, XAUTHORITY: process.env.XAUTHORITY };
  const merged = {
    ...(baseEnv === 'minimal' ? display : process.env),
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    FORKLIFT_SHELL_ENV: 'off',
    WAYLAND_DISPLAY: undefined,
    ...env,
  };
  const childEnv = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));

  const cdpPort = page ? await freePort() : null;
  const inspectPort = inspect ? await freePort() : null;
  const argv = [
    ...(binary ? [] : ['.']),
    ...(cdpPort ? [`--remote-debugging-port=${cdpPort}`] : []),
    ...(inspectPort ? [`--inspect=${inspectPort}`] : []),
    '--ozone-platform=x11',
    `--window-size=${windowSize}`,
    // Chromium refuses to start as root with its sandbox on; CI containers (GitVerse's cloud runner) run as
    // root. Tests only: the app itself never turns the sandbox off.
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    // Never the user's keychain (KDE Wallet, GNOME Keyring): tests run with the user's desktop session and
    // would open its dialogs and store test secrets there.
    '--password-store=basic',
    ...args,
  ];
  const child = spawn(await electronBinary(), argv, { cwd: projectDir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (data) => (logs += data));
  child.stderr.on('data', (data) => (logs += data));
  const exited = new Promise((resolve) => child.once('exit', resolve));

  const app = {
    child,
    home,
    get logs() {
      return logs;
    },
    page: null,
    main: null,
    async close() {
      app.page?.close();
      app.main?.close();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await Promise.race([exited, sleep(5000)]);
      }
    },
  };
  defer(() => app.close());
  launched.push(app);

  if (cdpPort) app.page = await connect(cdpPort, (targets) => targets.find((t) => t.type === 'page'), () => logs);
  if (inspectPort) app.main = await connect(inspectPort, (targets) => targets[0], () => logs);
  if (app.page) {
    await app.page.send('Runtime.enable');
    await app.page.send('Log.enable');
    await app.page.send('Page.enable');
    await app.page.waitFor('!!document.querySelector(".app")', 15000);
  }
  if (app.main) {
    await app.main.waitFor(`typeof globalThis.forkliftDebug === 'object'`, 15000);
  }
  return app;
}

async function connect(port, pick, logs) {
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(250);
    try {
      target = pick(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json());
    } catch {
      // not listening yet
    }
  }
  if (!target) throw new Error(`no debug target on port ${port}\n${logs().slice(-2000)}`);
  return new CdpSession(target.webSocketDebuggerUrl).open();
}

/** One DevTools protocol connection: evaluate, wait for conditions, real mouse and keyboard input. */
export class CdpSession {
  #ws;
  #nextId = 1;
  #pending = new Map();
  /** Uncaught exceptions, console errors/warnings and log errors (CSP violations) seen so far. */
  problems = [];

  constructor(url) {
    this.url = url;
  }

  async open() {
    this.#ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.#ws.onopen = resolve;
      this.#ws.onerror = reject;
    });
    this.#ws.onmessage = (event) => this.#onMessage(JSON.parse(event.data));
    this.#ws.onclose = () => {
      for (const resolve of this.#pending.values()) resolve({ error: { message: 'connection closed' } });
      this.#pending.clear();
    };
    return this;
  }

  #onMessage(message) {
    if (message.id) {
      this.#pending.get(message.id)?.(message);
      this.#pending.delete(message.id);
      return;
    }
    const { method, params } = message;
    if (method === 'Runtime.exceptionThrown') {
      this.problems.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    } else if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(params.type)) {
      this.problems.push(params.args.map((arg) => arg.value ?? arg.description).join(' '));
    } else if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level)) {
      this.problems.push(params.entry.text);
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.#ws.readyState !== WebSocket.OPEN) return reject(new Error(`${method}: connection closed`));
      const id = this.#nextId++;
      this.#pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluates an expression (promises awaited) and returns its JSON value; a thrown error becomes its description. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) return result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    return result.result?.value ?? result.result?.description;
  }

  /** `invoke('repo:open', path)` → the IpcResult envelope, as the renderer sees it. */
  invoke(command, ...args) {
    return this.evaluate(`window.forklift.invoke(${JSON.stringify(command)}, ...${JSON.stringify(args)})`);
  }

  /** Polls until the expression is truthy; returns its last value either way. */
  async waitFor(expression, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await this.evaluate(expression);
      if (value) return value;
      await sleep(100);
    }
    return this.evaluate(expression);
  }

  /** Text of an element with Monaco's non-breaking spaces turned back into spaces. */
  text(selector) {
    return this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\u00a0/g, ' ')`);
  }

  async clickAt(x, y) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  }

  /**
   * Clicks the centre of the element an expression yields, with real mouse events (Monaco ignores el.click()).
   * Waits until the element stays put for a frame and is the one under that point: layout that shifts as the
   * page updates would otherwise send the click to a neighbour.
   */
  async click(expression) {
    let box = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      box = await this.evaluate(`(async () => {
        const el = (${expression});
        if (!(el instanceof Element)) return null;
        el.scrollIntoView({ block: 'nearest' });
        const rect = () => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
        const first = rect();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const second = rect();
        const hit = document.elementFromPoint(second.x, second.y);
        const ready = first.x === second.x && first.y === second.y && hit !== null && (el === hit || el.contains(hit));
        return { ...second, ready };
      })()`);
      if (!box || !Number.isFinite(box.x)) throw new Error(`not found: ${expression}`);
      if (box.ready) break;
      await sleep(50);
    }
    await this.clickAt(box.x, box.y);
  }

  /** Drags the centre of an element `dx` pixels sideways with the mouse, in a few steps. */
  async drag(expression, dx, dy = 0) {
    const box = await this.evaluate(`(() => { const el = (${expression}); if (!(el instanceof Element)) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!box) throw new Error(`not found: ${expression}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 5; step++) {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + (dx * step) / 5, y: box.y + (dy * step) / 5, button: 'left', buttons: 1 });
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + dx, y: box.y + dy, button: 'left', buttons: 0, clickCount: 1 });
  }

  /** Types into the focused element. */
  insertText(text) {
    return this.send('Input.insertText', { text });
  }

  /** Focuses an input, selects its content and types `text` over it (an empty string clears it). */
  async fill(expression, text) {
    const found = await this.evaluate(`(() => { const el = (${expression}); if (!el) return false; el.focus(); el.select?.(); return true; })()`);
    if (!found) throw new Error(`not found: ${expression}`);
    if (text) await this.insertText(text);
    else await this.press('Delete', { keyCode: 46 });
  }

  /** Picks an option of a <select> the way a user would (React sees a change event). */
  async selectOption(expression, value) {
    const ok = await this.evaluate(`(() => { const el = (${expression}); if (!el || ![...el.options].some(o => o.value === ${JSON.stringify(value)})) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`no option ${value} in ${expression}`);
  }

  async press(key, { code = key, keyCode, modifiers = 0 } = {}) {
    const codes = { Escape: 27, Enter: 13, Tab: 9, Delete: 46 };
    const windowsVirtualKeyCode = keyCode ?? codes[key] ?? key.toUpperCase().charCodeAt(0);
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
  }

  async screenshot(file) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
  }

  /** Console problems except Electron's dev-only security banner. */
  relevantProblems() {
    return this.problems.filter((problem) => !/Electron Security Warning|DevTools/.test(problem ?? ''));
  }

  close() {
    this.#ws?.close();
  }
}

/** In the main process: runs `code` inside an async function with forkliftDebug's services in scope. */
export function inMain(app, code) {
  return app.main.evaluate(`(async () => { const { store, runner, gitCli, tools, diffTools, staging, settings, toolActions } = globalThis.forkliftDebug; ${code} })()`);
}

/** Lines of `ps -eo args` that equal `command` exactly (Linux/macOS). */
export function processesMatching(command) {
  return execFileSync('ps', ['-eo', 'args']).toString().split('\n').filter((line) => line.trim() === command);
}
