// Interactive rebase plans, as the window edits them and main turns them into git's todo list.

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

export interface RebaseCommit {
  sha: string;
  subject: string;
  /** Full message. */
  message: string;
}

/** One commit of the plan, oldest first (git's order). `message`: the new message for reword, or for a squash group's first commit. */
export interface RebaseStep {
  sha: string;
  action: RebaseAction;
  message?: string;
}

/** Why a plan cannot run, or null. */
export function planProblem(steps: readonly RebaseStep[]): string | null {
  const kept = steps.filter((step) => step.action !== 'drop');
  if (kept[0] && (kept[0].action === 'squash' || kept[0].action === 'fixup')) return 'The first commit cannot be squashed or fixed up: there is nothing before it to combine with';
  for (const step of steps) {
    if ((step.action === 'reword') && !step.message?.trim()) return 'A reworded commit needs a message';
  }
  return null;
}
