import type { BlameCommit, BlameResult, FileHistoryEntry } from '../../shared/fileHistory';
import type { GitCli } from './cli';

const STATUS: Record<string, FileHistoryEntry['status']> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'typechange' };
const MAX_ENTRIES = 2000;

/** `git log --follow --name-status` output → entries; renames carry the old path. */
export function parseFileLog(output: string): FileHistoryEntry[] {
  const entries: FileHistoryEntry[] = [];
  for (const record of output.split('\x01').map((part) => part.trim()).filter(Boolean)) {
    const [header = '', ...rest] = record.split('\n');
    const [sha = '', authorName = '', authorEmail = '', time = '0', subject = ''] = header.split('\x00');
    const change = rest.map((line) => line.trim()).find((line) => /^[AMDRCT]\d*\t/.test(line));
    if (!change) continue;
    const [code = 'M', first = '', second] = change.split('\t');
    const status = STATUS[code[0]!] ?? 'modified';
    entries.push({
      sha,
      authorName,
      authorEmail,
      time: Number(time),
      subject,
      path: second ?? first,
      ...(second && { oldPath: first }),
      status,
    });
  }
  return entries;
}

/** `git blame --porcelain` → text, line hunks and the commits they come from. */
export function parseBlame(output: string): BlameResult {
  const lines = output.split('\n');
  const text: string[] = [];
  const hunks: BlameResult['hunks'] = [];
  const commits: Record<string, BlameCommit> = {};
  let current: string | null = null;
  let pending: Partial<BlameCommit> = {};
  for (const line of lines) {
    if (line.startsWith('\t')) {
      text.push(line.slice(1));
      const number = text.length;
      const last = hunks.at(-1);
      if (last && last.sha === current && last.start + last.count === number) last.count += 1;
      else hunks.push({ sha: current!, start: number, count: 1 });
      if (current && !commits[current]) {
        commits[current] = { authorName: pending.authorName ?? '', authorEmail: pending.authorEmail ?? '', time: pending.time ?? 0, summary: pending.summary ?? '' };
      }
      continue;
    }
    const header = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ \d+/.exec(line);
    if (header) {
      current = header[1]!;
      if (!commits[current]) pending = {};
      continue;
    }
    const space = line.indexOf(' ');
    const key = space < 0 ? line : line.slice(0, space);
    const value = space < 0 ? '' : line.slice(space + 1);
    if (key === 'author') pending.authorName = value;
    else if (key === 'author-mail') pending.authorEmail = value.replace(/^<|>$/g, '');
    else if (key === 'author-time') pending.time = Number(value);
    else if (key === 'summary') pending.summary = value;
  }
  return { text: text.join('\n'), hunks, commits };
}

export class FileHistory {
  constructor(private readonly git: GitCli) {}

  /** Commits that changed the file, newest first, following renames. */
  async log(root: string, path: string, range?: { base: string; head: string }): Promise<FileHistoryEntry[]> {
    const { stdout } = await this.git.exec(
      ['log', '--follow', '-M', `-n${MAX_ENTRIES}`, '--name-status', '--format=%x01%H%x00%an%x00%ae%x00%at%x00%s', ...(range ? [range.head, `^${range.base}`] : []), '--', path],
      { cwd: root, readOnly: true, env: { GIT_LITERAL_PATHSPECS: '1' } },
    );
    return parseFileLog(stdout);
  }

  /** Line authorship at a commit, or of the working tree file (`rev` null; uncommitted lines get the zero sha). */
  async blame(root: string, path: string, rev: string | null): Promise<BlameResult> {
    const args = ['blame', '--porcelain', '-M', ...(rev ? [rev] : []), '--', path];
    const { stdout } = await this.git.exec(args, { cwd: root, readOnly: true, env: { GIT_LITERAL_PATHSPECS: '1' }, timeoutMs: 120_000 });
    return parseBlame(stdout);
  }
}
