import { useCallback, useState } from 'react';
import type { DiffTarget } from '../../../shared/diff';
import type { RepoData } from '../../../shared/state';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { ChangesPanel } from './ChangesPanel';
import { CommitDetailsPanel } from './CommitDetailsPanel';
import { CommitList } from './CommitList';
import { DiffView } from './DiffView';

interface RepoWorkspaceProps {
  data: RepoData;
  run: RunAction;
  runInBackground: RunAction;
}

/** Center: commit list or an open diff. Side: the selected commit's details or the working changes. */
export function RepoWorkspace({ data, run, runInBackground }: RepoWorkspaceProps) {
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const closeDiff = useCallback(() => setDiffTarget(null), []);
  const worktreeDiff = diffTarget?.kind === 'worktree' ? diffTarget : null;

  return (
    <main className="workspace">
      {diffTarget ? (
        <DiffView
          key={JSON.stringify(diffTarget)}
          target={diffTarget}
          title={diffTarget.oldPath ? `${diffTarget.oldPath} → ${diffTarget.path}` : diffTarget.path}
          subtitle={diffTarget.kind === 'commit' ? diffTarget.sha.slice(0, 7) : diffTarget.staged ? 'Staged' : 'Unstaged'}
          // Working-tree diffs follow refreshes; commit diffs never change.
          reloadKey={diffTarget.kind === 'worktree' ? data.loadedAt : undefined}
          onClose={closeDiff}
          actions={
            worktreeDiff && (
              <>
                <button type="button" onClick={() => run(() => invoke('file:openInEditor', worktreeDiff.path))}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => runInBackground(() => invoke('file:externalDiff', worktreeDiff.path, worktreeDiff.staged))}
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
      {selectedCommit ? (
        <CommitDetailsPanel
          key={selectedCommit}
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
        <ChangesPanel
          changes={data.changes}
          selected={worktreeDiff && { path: worktreeDiff.path, staged: worktreeDiff.staged }}
          onShowDiff={(change, staged) => {
            // A rename already in the index is under its new name there, so the unstaged side needs no old path.
            const oldPath = staged || !change.staged ? change.origPath : undefined;
            setDiffTarget({ kind: 'worktree', path: change.path, staged, ...(oldPath && { oldPath }) });
          }}
          onOpenInEditor={(path) => run(() => invoke('file:openInEditor', path))}
          onExternalDiff={(path, staged) => runInBackground(() => invoke('file:externalDiff', path, staged))}
          onExternalMerge={(path) => runInBackground(() => invoke('file:externalMerge', path))}
        />
      )}
    </main>
  );
}
