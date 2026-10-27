import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { BisectActivity, BisectMark, BisectStatus } from '../../shared/bisect';
import { GitCli } from './cli';
import { RepoQueue } from './repoQueue';

const shaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;

/** Reads Git's bisect refs on every request, so sessions survive application restarts. */
export class BisectService {
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly git: GitCli, private readonly queue: RepoQueue) {}

  async status(root: string): Promise<BisectStatus | null> {
    const gitDir = (await this.git.exec(['rev-parse', '--absolute-git-dir'], { cwd: root, readOnly: true })).stdout.trim();
    try { await access(join(gitDir, 'BISECT_START')); } catch { return null; }
    const [refs, log] = await Promise.all([
      this.git.exec(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/bisect'], { cwd: root, readOnly: true }),
      this.git.exec(['bisect', 'log'], { cwd: root, readOnly: true }),
    ]);
    const good: string[] = [];
    const skipped: string[] = [];
    let bad: string | null = null;
    for (const line of refs.stdout.trim().split('\n')) {
      const [name, sha] = line.split(' ');
      if (!sha || !shaPattern.test(sha)) continue;
      if (name === 'refs/bisect/bad') bad = sha;
      else if (name?.startsWith('refs/bisect/good-')) good.push(sha);
      else if (name?.startsWith('refs/bisect/skip-')) skipped.push(sha);
    }
    const found = /# first bad commit: \[([0-9a-f]{40,64})\]/i.exec(log.stdout)?.[1] ?? null;
    let candidates: string[] = [];
    let steps: number | null = null;
    if (bad && good.length) {
      const bounds = [bad, '--not', ...good];
      const [list, vars] = await Promise.all([
        this.git.exec(['rev-list', ...bounds], { cwd: root, readOnly: true }),
        this.git.exec(['rev-list', '--bisect-vars', ...bounds], { cwd: root, readOnly: true }),
      ]);
      candidates = list.stdout.trim().split('\n').filter((sha) => shaPattern.test(sha) && !skipped.includes(sha));
      steps = Number(/bisect_steps=(\d+)/.exec(vars.stdout)?.[1] ?? 0);
    }
    const tested = log.stdout.split('\n').filter((line) => /^git bisect (?:good|bad|skip)\b/.test(line)).length;
    return { good, bad, skipped, candidates, remaining: bad && good.length ? candidates.length : null, steps, tested, found, log: log.stdout };
  }

  mark(root: string, mark: BisectMark, sha: string): Promise<void> {
    if (!shaPattern.test(sha)) throw new TypeError('sha must be a full commit hash');
    if (!['good', 'bad', 'skip'].includes(mark)) throw new TypeError('Invalid bisect mark');
    return this.queue.run(root, async () => {
      if (this.running.has(root)) throw new Error('Bisect run is still running');
      if (!(await this.status(root))) {
        if (mark === 'skip') throw new Error('Mark a good or bad commit to start bisect');
        const dirty = await this.git.exec(['status', '--porcelain'], { cwd: root, readOnly: true });
        if (dirty.stdout.trim()) throw new Error('Commit or stash changes before starting bisect');
        await this.git.exec(['bisect', 'start'], { cwd: root });
      }
      await this.git.exec(['bisect', mark, sha], { cwd: root });
    });
  }

  reset(root: string): Promise<void> {
    return this.queue.run(root, async () => {
      if (this.running.has(root)) throw new Error('Stop bisect run first');
      await this.git.exec(['bisect', 'reset'], { cwd: root });
    });
  }

  async run(root: string, executable: string, args: string[], onActivity: (activity: BisectActivity) => void): Promise<void> {
    if (!executable.trim() || /[\r\n\0]/.test(executable) || executable.length > 4096 || args.length > 100 || args.some((arg) => arg.length > 4096 || /\0/.test(arg))) {
      throw new TypeError('Invalid bisect command');
    }
    if (this.running.has(root)) throw new Error('Bisect run is already running');
    await this.queue.run(root, async () => {
      const status = await this.status(root);
      if (!status?.bad || !status.good.length) throw new Error('Mark a good and a bad commit first');
      const controller = new AbortController();
      this.running.set(root, controller);
      const output: string[] = [];
      const append = (line: string) => {
        output.push(line);
        if (output.length > 200) output.shift();
        onActivity({ running: true, output: [...output] });
      };
      onActivity({ running: true, output: [] });
      try {
        await this.git.exec(['bisect', 'run', executable, ...args], { cwd: root, signal: controller.signal, onStdoutLine: append, onStderrLine: append, streamOnly: true });
      } finally {
        this.running.delete(root);
        onActivity({ running: false, output: [...output] });
      }
    });
  }

  cancel(root: string): void { this.running.get(root)?.abort(); }
}
