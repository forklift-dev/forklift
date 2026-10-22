import { useCallback, useState } from 'react';
import type { DiffTarget } from '../../../shared/diff';
import type { RepoData } from '../../../shared/state';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { ChangesPanel } from './ChangesPanel';
import { CommitDetailsPanel } from './CommitDetailsPanel';
import { CommitList } from './CommitList';
import { CommitPanel } from './CommitPanel';
import { useConfirm } from './ConfirmDialog';
import { DiffView, type DiffEditing } from './DiffView';

interface RepoWorkspaceProps {
  data: RepoData;
  run: RunAction;
  runInBackground: RunAction;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Center: commit list or an open diff. Side: the selected commit's details, or working changes and the commit form. */
export function RepoWorkspace({ data, run, runInBackground }: RepoWorkspaceProps) {
  const repo = data.root;
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const { confirm, dialog } = useConfirm();
  const closeDiff = useCallback(() => setDiffTarget(null), []);
  const worktreeDiff = diffTarget?.kind === 'worktree' ? diffTarget : null;

  const confirmDiscard = (what: string) =>
    confirm({ title: `Discard ${what}?`, detail: 'This cannot be undone.', confirmLabel: 'Discard', danger: true });

  const discardFiles = async (paths: string[]) => {
    const untracked = paths.filter((path) => data.changes.find((c) => c.path === path)?.kind === 'untracked').length;
    const what = paths.length === 1 ? `changes in ${paths[0]}` : `changes in ${plural(paths.length, 'file')}`;
    const ok = await confirm({
      title: `Discard ${what}?`,
      detail: untracked ? `${plural(untracked, 'untracked file')} will be deleted. This cannot be undone.` : 'This cannot be undone.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (ok) await run(() => invoke('index:discard', repo, paths));
  };

  const editing: DiffEditing | undefined = worktreeDiff
    ? {
        mode: worktreeDiff.staged ? 'staged' : 'unstaged',
        apply: async (request) => {
          await run(() => invoke('index:applyLines', repo, request));
        },
        confirmDiscard,
      }
    : undefined;

  const stagedCount = data.changes.filter((c) => c.staged).length;

  return (
    <main className="workspace">
      {diffTarget ? (
        <DiffView
          key={JSON.stringify(diffTarget)}
          repo={repo}
          target={diffTarget}
          title={diffTarget.oldPath ? `${diffTarget.oldPath} → ${diffTarget.path}` : diffTarget.path}
          subtitle={diffTarget.kind === 'commit' ? diffTarget.sha.slice(0, 7) : diffTarget.staged ? 'Staged' : 'Unstaged'}
          // Working-tree diffs follow refreshes; commit diffs never change.
          reloadKey={diffTarget.kind === 'worktree' ? data.loadedAt : undefined}
          editing={editing}
          onClose={closeDiff}
          actions={
            worktreeDiff && (
              <>
                <button type="button" onClick={() => void run(() => invoke('file:openInEditor', repo, worktreeDiff.path))}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void runInBackground(() => invoke('file:externalDiff', repo, worktreeDiff.path, worktreeDiff.staged))}
                >
                  External
                </button>
              </>
            )
          }
        />
      ) : (
        <CommitList
          commits={data.commits}
          selectedHash={selectedCommit}
          onSelect={(hash) => setSelectedCommit((current) => (current === hash ? null : hash))}
        />
      )}
      <aside className="side">
        {selectedCommit ? (
          <CommitDetailsPanel
            key={selectedCommit}
            repo={repo}
            sha={selectedCommit}
            selectedPath={diffTarget?.kind === 'commit' ? diffTarget.path : null}
            onOpenFile={(file) =>
              setDiffTarget({ kind: 'commit', sha: selectedCommit, path: file.path, ...(file.oldPath && { oldPath: file.oldPath }) })
            }
            onClose={() => {
              setSelectedCommit(null);
              setDiffTarget((target) => (target?.kind === 'commit' ? null : target));
            }}
          />
        ) : (
          <>
            <ChangesPanel
              changes={data.changes}
              selected={worktreeDiff && { path: worktreeDiff.path, staged: worktreeDiff.staged }}
              onShowDiff={(change, staged) => {
                // A rename already in the index is under its new name there, so the unstaged side needs no old path.
                const oldPath = staged || !change.staged ? change.origPath : undefined;
                setDiffTarget({ kind: 'worktree', path: change.path, staged, ...(oldPath && { oldPath }) });
              }}
              onStage={(paths) => void run(() => invoke('index:stage', repo, paths))}
              onUnstage={(paths) => void run(() => invoke('index:unstage', repo, paths))}
              onDiscard={(paths) => void discardFiles(paths)}
              onOpenInEditor={(path) => void run(() => invoke('file:openInEditor', repo, path))}
              onExternalDiff={(path, staged) => void runInBackground(() => invoke('file:externalDiff', repo, path, staged))}
              onExternalMerge={(path) => void runInBackground(() => invoke('file:externalMerge', repo, path))}
            />
            <CommitPanel
              repo={repo}
              stagedCount={stagedCount}
              headSha={data.branch.oid}
              onCommit={(message, amend) => run(() => invoke('commit:create', repo, message, amend))}
            />
          </>
        )}
      </aside>
      {dialog}
    </main>
  );
}
