import type { GitCli } from './cli';

export interface RepositoryHealthReport {
  healthy: boolean;
  integrity: string[];
  objectStore: { loose: number; packed: number; size: string; packs: number };
  largeFiles: { path: string; size: number }[];
  scannedObjects: number;
  truncated: boolean;
}

/** Read-only diagnostics; never runs maintenance or writes to the repository. */
export class RepositoryHealthService {
  constructor(private readonly git: GitCli) {}

  async scan(root: string): Promise<RepositoryHealthReport> {
    const [objects, tree] = await Promise.all([
      this.git.exec(['count-objects', '-vH'], { cwd: root, readOnly: true }),
      this.git.exec(['rev-list', '--objects', '--all'], { cwd: root, readOnly: true, timeoutMs: 30_000 }),
    ]);
    const stats = Object.fromEntries(objects.stdout.split(/\r?\n/).map((line) => {
      const colon = line.indexOf(':');
      return colon < 0 ? ['', ''] : [line.slice(0, colon), line.slice(colon + 1).trim()];
    }));
    const entries = tree.stdout.split(/\r?\n/).filter(Boolean).slice(0, 10_001);
    const truncated = entries.length > 10_000;
    const ids = entries.slice(0, 10_000).map((line) => line.slice(0, line.indexOf(' '))).filter((id) => /^[0-9a-f]{40,64}$/i.test(id));
    const sized = ids.length ? await this.git.exec(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize) %(rest)'], {
      cwd: root, readOnly: true, input: `${entries.slice(0, 10_000).join('\n')}\n`, timeoutMs: 30_000,
    }) : { stdout: '' };
    const largeFiles = sized.stdout.split(/\r?\n/).flatMap((line) => {
      const match = /^\S+ blob (\d+) (.*)$/.exec(line);
      if (!match || Number(match[1]) < 10 * 1024 * 1024) return [];
      return [{ path: match[2]!, size: Number(match[1]) }];
    }).sort((a, b) => b.size - a.size).slice(0, 20);
    let integrity: string[] = [];
    try {
      const fsck = await this.git.exec(['fsck', '--full', '--no-reflogs'], { cwd: root, readOnly: true, timeoutMs: 60_000 });
      integrity = `${fsck.stdout}\n${fsck.stderr}`.split(/\r?\n/).filter((line) => /^(error|warning|missing|dangling|broken|unreachable)/i.test(line.trim()));
    } catch (error) {
      const output = error instanceof Error && 'stderr' in error ? `${String((error as { stdout?: string }).stdout ?? '')}\n${String((error as { stderr?: string }).stderr ?? '')}` : String(error);
      integrity = output.split(/\r?\n/).filter(Boolean).slice(0, 50);
      if (!integrity.length) integrity = [String(error)];
    }
    return {
      healthy: integrity.every((line) => /^(dangling|unreachable)/i.test(line.trim())),
      integrity,
      objectStore: { loose: Number(stats.count ?? 0), packed: Number(stats['in-pack'] ?? 0), size: stats.size ?? '0 bytes', packs: Number(stats['packs'] ?? 0) },
      largeFiles,
      scannedObjects: ids.length,
      truncated,
    };
  }
}
