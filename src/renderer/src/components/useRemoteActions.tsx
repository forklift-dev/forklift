import type { MouseEvent, ReactNode } from 'react';
import type { RepoData } from '../../../shared/state';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { useConfirm } from './ConfirmDialog';
import type { MenuItem } from './ContextMenu';
import { useFormDialog } from './FormDialog';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface RemoteActions {
  pull(rebase?: boolean): void;
  fetch(): void;
  push(): void;
  pullMenu(event: MouseEvent, open: (event: MouseEvent, items: MenuItem[]) => void): void;
  dialogs: ReactNode;
}

/** Fetch, pull and push for the active repository, with the questions they can raise. */
export function useRemoteActions(repo: string | null, data: RepoData | null, run: RunAction): RemoteActions {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { form, dialog: formDialog } = useFormDialog();

  const push = async (remote: string | null, force: boolean): Promise<void> => {
    if (!repo || !data) return;
    try {
      await invoke('remote:push', repo, remote, force);
    } catch (error) {
      const message = errorText(error);
      if (/has no upstream branch/.test(message)) return choosePushTarget();
      if (message.startsWith('Rejected:') && !force) {
        const ok = await confirm({
          title: `The remote has commits that ${data.branch.head} does not have`,
          detail: `Pull first to bring them in. Or force push (with lease): the remote branch is replaced by yours, unless it moved again since your last fetch.\n\n${message.replace(/^Rejected: /, '')}`,
          confirmLabel: 'Force push',
          danger: true,
        });
        if (ok) await run(() => invoke('remote:push', repo, remote, true));
        return;
      }
      await run(() => Promise.reject(error));
    }
  };

  /** A branch without upstream: pushed to a remote of the user's choice and tracked from then on. */
  const choosePushTarget = async () => {
    if (!repo || !data) return;
    const branch = data.branch.head ?? '';
    if (data.remotes.length === 0) return void run(() => Promise.reject(new Error('This repository has no remotes to push to')));
    if (data.remotes.length === 1) {
      const remote = data.remotes[0]!;
      const ok = await confirm({ title: `Push ${branch} to ${remote}?`, detail: `It is created as ${remote}/${branch} and becomes the branch's upstream.`, confirmLabel: 'Push' });
      if (ok) await run(() => invoke('remote:push', repo, remote, false));
      return;
    }
    await form({
      title: `Push ${branch}`,
      detail: 'The new remote branch becomes its upstream.',
      fields: [{ name: 'remote', label: 'Remote', type: 'select', initial: data.remotes.includes('origin') ? 'origin' : data.remotes[0], options: data.remotes.map((r) => ({ value: r, label: r })) }],
      confirmLabel: 'Push',
      submit: async (values) => {
        try {
          await invoke('remote:push', repo, String(values['remote']), false);
          return null;
        } catch (error) {
          return errorText(error);
        }
      },
    });
  };

  return {
    pull: (rebase) => repo && data && void run(() => invoke('remote:pull', repo, rebase ?? data.pullRebase)),
    fetch: () => repo && void run(() => invoke('remote:fetch', repo, null, true)),
    push: () => void push(null, false),
    pullMenu: (event, open) =>
      open(event, [
        { label: 'Fetch all', onSelect: () => repo && void run(() => invoke('remote:fetch', repo, null, true)) },
        'separator',
        { label: `Pull (merge)${data?.pullRebase ? '' : ' — default'}`, disabled: !data?.branch.head, onSelect: () => repo && void run(() => invoke('remote:pull', repo, false)) },
        { label: `Pull (rebase)${data?.pullRebase ? ' — default' : ''}`, disabled: !data?.branch.head, onSelect: () => repo && void run(() => invoke('remote:pull', repo, true)) },
      ]),
    dialogs: (
      <>
        {confirmDialog}
        {formDialog}
      </>
    ),
  };
}
