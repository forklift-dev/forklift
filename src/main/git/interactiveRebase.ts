import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planProblem, type RebaseCommit, type RebaseStep } from '../../shared/rebase';
import { t, translate } from '../../shared/i18n';
import { GitCliError, type GitCli } from './cli';
import type { CommitOpResult } from './commitOps';
import { RepoQueue } from './repoQueue';

export class RebaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RebaseError';
  }
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const shQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/**
 * Builds git's todo list. Reword and squash need new messages; instead of an editor, a group (a commit and
 * the commits squashed or fixed up into it) is picked and fixed up, then amended with its message from a
 * file: `exec git commit --amend -F <file>`. `messages` are the commits' current messages, for defaults.
 */
export function buildTodo(
  steps: readonly RebaseStep[],
  messages: ReadonlyMap<string, string>,
  messageFile: (index: number) => string,
): { todo: string; files: Map<string, string> } {
  const lines: string[] = [];
  const files = new Map<string, string>();
  let head: RebaseStep | null = null;
  let squashed: string[] = [];
  const closeGroup = () => {
    if (!head) return;
    // Squash without an edited message: both messages, as git would offer them.
    const message = head.message?.trim() ? head.message : squashed.length ? [messages.get(head.sha) ?? '', ...squashed].join('\n\n') : null;
    if (message !== null && (head.action === 'reword' || squashed.length > 0)) {
      const file = messageFile(files.size);
      files.set(file, message);
      lines.push(`exec git commit --amend --allow-empty -q -F ${shQuote(file)}`);
    }
    head = null;
    squashed = [];
  };
  for (const step of steps) {
    if (step.action === 'drop') lines.push(`drop ${step.sha}`);
    else if (step.action === 'squash' || step.action === 'fixup') {
      lines.push(`fixup ${step.sha}`);
      if (step.action === 'squash') squashed.push(messages.get(step.sha) ?? '');
    } else {
      closeGroup();
      lines.push(`pick ${step.sha}`);
      head = step;
    }
  }
  closeGroup();
  return { todo: `${lines.join('\n')}\n`, files };
}

/** `git rebase -i` driven by a plan from the window instead of an editor. */
export class InteractiveRebase {
  constructor(
    private readonly git: GitCli,
    private readonly queue = new RepoQueue(),
  ) {}

  /** The commits after `base` up to HEAD, oldest first; merges are not supported (they would be flattened). */
  async plan(root: string, base: string): Promise<RebaseCommit[]> {
    assertSha(base);
    const { stdout } = await this.git.exec(['log', '--reverse', '--format=%H%x00%P%x00%B%x01', `${base}..HEAD`], { cwd: root, readOnly: true });
    const commits: RebaseCommit[] = [];
    for (const record of stdout.split('\x01').map((part) => part.replace(/^\n/, '')).filter(Boolean)) {
      const [sha = '', parents = '', message = ''] = record.split('\x00');
      if (parents.trim().split(' ').length > 1) throw new RebaseError(t('There is a merge commit after this commit; interactive rebase across merges is not supported'));
      commits.push({ sha, subject: message.split('\n')[0] ?? '', message: message.trimEnd() });
    }
    const ancestor = await this.git.exec(['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: root, readOnly: true, allowedExitCodes: [1] });
    if (ancestor.exitCode !== 0) throw new RebaseError(t('Choose a commit of the current branch'));
    return commits;
  }

  /** Runs the plan; 'conflicts' when git stopped (the operation banner continues it, also after a restart). */
  run(root: string, base: string, steps: RebaseStep[]): Promise<CommitOpResult> {
    return this.queue.run(root, async () => {
      const commits = await this.plan(root, base);
      const planned = commits.map((commit) => commit.sha);
      if (steps.length !== planned.length || [...steps.map((s) => s.sha)].sort().join() !== [...planned].sort().join()) {
        throw new RebaseError(t('The branch changed since the plan was made; open the interactive rebase again'));
      }
      const problem = planProblem(steps);
      if (problem) throw new RebaseError(translate(problem));

      // Inside the git directory: the messages must outlive an app restart in the middle of the rebase.
      const gitDir = (await this.git.exec(['rev-parse', '--absolute-git-dir'], { cwd: root, readOnly: true })).stdout.trim();
      const dir = join(gitDir, 'forklift-rebase');
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const current = new Map(commits.map((commit) => [commit.sha, commit.message]));
      const { todo, files } = buildTodo(steps, current, (index) => join(dir, `message-${index}.txt`));
      for (const [file, message] of files) await writeFile(file, message.endsWith('\n') ? message : `${message}\n`);
      const todoFile = join(dir, 'todo');
      await writeFile(todoFile, todo);
      try {
        await this.git.exec(['rebase', '-i', '--autostash', base], { cwd: root, env: { GIT_SEQUENCE_EDITOR: `cp ${shQuote(todoFile)}` } });
        return 'done';
      } catch (error) {
        if (!(error instanceof GitCliError)) throw error;
        const state = await this.git.exec(['rev-parse', '--git-path', 'rebase-merge'], { cwd: root, readOnly: true });
        const stopped = await this.git.exec(['rev-parse', '-q', '--verify', 'REBASE_HEAD'], { cwd: root, readOnly: true, allowedExitCodes: [1] });
        if (state.stdout.trim() && stopped.exitCode === 0) return 'conflicts';
        const output = `${error.stderr}\n${error.stdout}`.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('hint:'));
        throw new RebaseError(output.slice(-10).join('\n') || error.message);
      }
    });
  }
}

function assertSha(sha: string): void {
  if (!SHA.test(sha)) throw new RebaseError('A full commit hash is required');
}
