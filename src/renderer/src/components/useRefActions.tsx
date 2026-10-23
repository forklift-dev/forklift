import type { ReactNode } from 'react';
import type { CheckoutTarget } from '../../../shared/branches';
import type { RepoData } from '../../../shared/state';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { useConfirm } from './ConfirmDialog';
import { useFormDialog } from './FormDialog';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Attempts an action; resolves to its error message or null (for dialogs that stay open on errors). */
async function attempt(action: () => Promise<unknown>): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (error) {
    return errorText(error);
  }
}

export interface RefActions {
  /** A commit or tag (detached HEAD) asks first. */
  checkout(target: CheckoutTarget): void;
  cherryPick(sha: string, subject: string): void;
  revert(sha: string, subject: string): void;
  reset(sha: string, mode: 'soft' | 'mixed' | 'hard'): void;
  /** Merge a branch/commit into the current branch (dialog with the merge mode). */
  merge(ref: string, label: string): void;
  /** Rebase the current branch onto a branch/commit (confirmation). */
  rebase(onto: string, label: string): void;
  createBranch(sha: string, from: string): void;
  createTag(sha: string, from: string): void;
  renameBranch(name: string): void;
  deleteBranch(name: string): void;
  deleteTag(name: string): void;
  /** Opens the stash dialog (message, untracked files, only staged). */
  stash(): void;
  applyStash(sha: string): void;
  popStash(sha: string): void;
  dropStash(sha: string, label: string): void;
  dialogs: ReactNode;
}

/** Branch and tag actions with their dialogs, shared by the left panel, the graph and the toolbar. */
export function useRefActions(repo: string, data: RepoData, run: RunAction): RefActions {
  const { form, dialog: formDialog } = useFormDialog();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const validate = (kind: 'branch' | 'tag') => async (values: Record<string, string | boolean>) =>
    invoke('ref:validateName', repo, kind, String(values['name'] ?? '')).catch(errorText);

  return {
    checkout: (target) =>
      void (async () => {
        if (target.kind === 'commit') {
          const ok = await confirm({
            title: `Check out ${target.sha.slice(0, 7)}?`,
            detail: 'You will be on a detached HEAD: new commits belong to no branch until you create one here. Uncommitted changes are carried along.',
            confirmLabel: 'Check out',
          });
          if (!ok) return;
        }
        await run(() => invoke('branch:checkout', repo, target));
      })(),

    cherryPick: (sha) => void run(() => invoke('commit:cherryPick', repo, sha)),

    revert: (sha, subject) =>
      void (async () => {
        const ok = await confirm({ title: `Revert “${subject}”?`, detail: 'A new commit that undoes its changes is added to the current branch.', confirmLabel: 'Revert' });
        if (ok) await run(() => invoke('commit:revert', repo, sha));
      })(),

    reset: (sha, mode) =>
      void (async () => {
        const branch = headLabel(data);
        const detail = {
          soft: 'The commits after it are undone; their changes stay staged.',
          mixed: 'The commits after it are undone; their changes stay in the working tree, unstaged.',
          hard: 'The commits after it and ALL uncommitted changes are discarded. This cannot be undone from Forklift.',
        }[mode];
        const ok = await confirm({ title: `Reset ${branch} to ${sha.slice(0, 7)} (${mode})?`, detail, confirmLabel: `Reset ${mode}`, danger: mode === 'hard' });
        if (ok) await run(() => invoke('commit:reset', repo, sha, mode));
      })(),

    createBranch: (sha, from) =>
      void form({
        title: 'Create branch',
        detail: `From ${from}`,
        fields: [
          { name: 'name', label: 'Branch name', placeholder: 'feature/my-change' },
          { name: 'checkout', label: 'Check out the new branch', type: 'checkbox', initial: true },
        ],
        confirmLabel: 'Create branch',
        validate: validate('branch'),
        submit: (values) => attempt(() => invoke('branch:create', repo, String(values['name']), sha, values['checkout'] === true)),
      }),

    createTag: (sha, from) =>
      void form({
        title: 'Create tag',
        detail: `At ${from}`,
        fields: [
          { name: 'name', label: 'Tag name', placeholder: 'v1.0.0' },
          { name: 'message', label: 'Message (optional; makes an annotated tag)', type: 'textarea' },
        ],
        confirmLabel: 'Create tag',
        validate: validate('tag'),
        submit: (values) => {
          const message = String(values['message'] ?? '');
          return attempt(() => invoke('tag:create', repo, String(values['name']), sha, message.trim() ? message : null));
        },
      }),

    renameBranch: (name) =>
      void form({
        title: `Rename ${name}`,
        fields: [{ name: 'name', label: 'New name', initial: name }],
        confirmLabel: 'Rename',
        validate: async (values) => (values['name'] === name ? 'Enter a different name' : validate('branch')(values)),
        submit: (values) => attempt(() => invoke('branch:rename', repo, name, String(values['name']))),
      }),

    deleteBranch: (name) =>
      void (async () => {
        const ok = await confirm({ title: `Delete branch ${name}?`, detail: 'Only the branch is deleted; its commits stay while other branches contain them.', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        try {
          await invoke('branch:delete', repo, name, false);
        } catch (error) {
          if (!/not fully merged/i.test(errorText(error))) return void run(() => Promise.reject(error));
          const force = await confirm({
            title: `${name} is not merged`,
            detail: 'Its commits are not on any other branch and may be lost. Delete it anyway?',
            confirmLabel: 'Delete anyway',
            danger: true,
          });
          if (force) await run(() => invoke('branch:delete', repo, name, true));
        }
      })(),

    deleteTag: (name) =>
      void (async () => {
        const ok = await confirm({ title: `Delete tag ${name}?`, detail: 'The tag is deleted in this repository only.', confirmLabel: 'Delete', danger: true });
        if (ok) await run(() => invoke('tag:delete', repo, name));
      })(),

    stash: () =>
      void form({
        title: 'Stash changes',
        fields: [
          { name: 'message', label: 'Message (optional)', placeholder: 'What these changes are' },
          { name: 'untracked', label: 'Include untracked files', type: 'checkbox', initial: true },
          { name: 'staged', label: 'Only staged changes', type: 'checkbox', initial: false },
        ],
        confirmLabel: 'Stash',
        validate: async (values) => (values['untracked'] && values['staged'] ? 'Untracked files cannot be stashed together with only staged changes' : null),
        submit: (values) =>
          attempt(async () => {
            const stashed = await invoke('stash:push', repo, {
              message: String(values['message'] ?? ''),
              includeUntracked: values['untracked'] === true,
              stagedOnly: values['staged'] === true,
            });
            if (!stashed) throw new Error('There are no changes to stash');
          }),
      }),

    applyStash: (sha) => void run(() => invoke('stash:apply', repo, sha)),
    popStash: (sha) => void run(() => invoke('stash:pop', repo, sha)),
    dropStash: (sha, label) =>
      void (async () => {
        const ok = await confirm({ title: `Delete ${label}?`, detail: 'The stashed changes are lost.', confirmLabel: 'Delete', danger: true });
        if (ok) await run(() => invoke('stash:drop', repo, sha));
      })(),

    merge: (ref, label) =>
      void form({
        title: `Merge ${label} into ${headLabel(data)}`,
        detail: 'Uncommitted changes are stashed and put back afterwards.',
        fields: [
          {
            name: 'mode',
            label: 'How',
            type: 'select',
            initial: 'default',
            options: [
              { value: 'default', label: 'Fast-forward if possible, otherwise a merge commit' },
              { value: 'no-ff', label: 'Always create a merge commit' },
              { value: 'ff-only', label: 'Fast-forward only' },
              { value: 'squash', label: 'Squash into staged changes (commit them yourself)' },
            ],
          },
          { name: 'message', label: 'Merge commit message (optional)', placeholder: `Merge ${label}` },
        ],
        confirmLabel: 'Merge',
        submit: (values) =>
          attempt(() => invoke('branch:merge', repo, ref, values['mode'] as 'default' | 'no-ff' | 'ff-only' | 'squash', String(values['message'] ?? '').trim() || null)),
      }),

    rebase: (onto, label) =>
      void (async () => {
        const ok = await confirm({
          title: `Rebase ${headLabel(data)} onto ${label}?`,
          detail: `The commits of ${headLabel(data)} that ${label} does not have are re-applied on top of it (their hashes change). Uncommitted changes are stashed and put back afterwards.`,
          confirmLabel: 'Rebase',
        });
        if (ok) await run(() => invoke('branch:rebase', repo, onto));
      })(),

    dialogs: (
      <>
        {formDialog}
        {confirmDialog}
      </>
    ),
  };
}

/** The label of HEAD for dialogs: the current branch or a short sha. */
export const headLabel = (data: RepoData) => data.branch.head ?? data.branch.oid?.slice(0, 7) ?? 'HEAD';
