import { useCallback, useState } from 'react';
import type { DiffTarget } from '../../../shared/diff';
import type { RepoData } from '../../../shared/state';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { ChangesPanel } from './ChangesPanel';
import { CommitDetailsPanel } from './CommitDetailsPanel';
import { CommitGraph } from './CommitGraph';
import { ConflictView } from './ConflictView';
import { OperationBanner } from './OperationBanner';
import { copyText, useContextMenu } from './ContextMenu';
import { LeftPanel } from './LeftPanel';
import { useRefActions } from './useRefActions';
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
  const [conflictPath, setConflictPath] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const refActions = useRefActions(repo, data, run);
  const { open: openMenu, menu } = useContextMenu();
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
  const selectedStash = data.stashes.find((stash) => stash.sha === selectedCommit) ?? null;

  return (
    <main className="workspace">
      <LeftPanel data={data} actions={refActions} openMenu={openMenu} onSelectCommit={setSelectedCommit} />
      <div className="center">
      <OperationBanner repo={repo} data={data} run={run} />
      {conflictPath ? (
        <ConflictView key={conflictPath} repo={repo} path={conflictPath} run={run} runInBackground={runInBackground} onClose={() => setConflictPath(null)} />
      ) : diffTarget ? (
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
        <CommitGraph
          repo={repo}
          data={data}
          selectedHash={selectedCommit}
          onSelect={setSelectedCommit}
          onContextMenu={(event, row) => {
            setSelectedCommit(row.hash);
            const short = row.hash.slice(0, 7);
            if (row.stash) {
              const label = `stash@{${row.stash.index}}`;
              return openMenu(event, [
                { label: 'Apply stash', onSelect: () => refActions.applyStash(row.hash) },
                { label: 'Pop stash', onSelect: () => refActions.popStash(row.hash) },
                'separator',
                { label: 'Delete stash…', danger: true, onSelect: () => refActions.dropStash(row.hash, label) },
              ]);
            }
            const isHead = row.hash === data.branch.oid;
            const busy = data.operation !== null;
            openMenu(event, [
              { label: 'Check out this commit (detached)', disabled: isHead, onSelect: () => refActions.checkout({ kind: 'commit', sha: row.hash }) },
              'separator',
              { label: 'Cherry-pick commit', disabled: isHead || busy, onSelect: () => refActions.cherryPick(row.hash, row.subject) },
              { label: 'Revert commit…', disabled: busy, onSelect: () => refActions.revert(row.hash, row.subject) },
              'separator',
              { label: `Reset ${data.branch.head ?? 'HEAD'} to here: soft…`, disabled: isHead || busy, onSelect: () => refActions.reset(row.hash, 'soft') },
              { label: `Reset ${data.branch.head ?? 'HEAD'} to here: mixed…`, disabled: isHead || busy, onSelect: () => refActions.reset(row.hash, 'mixed') },
              { label: `Reset ${data.branch.head ?? 'HEAD'} to here: hard…`, danger: true, disabled: busy, onSelect: () => refActions.reset(row.hash, 'hard') },
              'separator',
              { label: 'Create branch here…', onSelect: () => refActions.createBranch(row.hash, short) },
              { label: 'Create tag here…', onSelect: () => refActions.createTag(row.hash, short) },
              'separator',
              { label: 'Copy commit SHA', onSelect: () => copyText(row.hash) },
              { label: 'Copy commit message', onSelect: () => copyText(row.subject) },
            ]);
          }}
        />
      )}
      </div>
      <aside className="side">
        {selectedCommit ? (
          <CommitDetailsPanel
            key={selectedCommit}
            repo={repo}
            sha={selectedCommit}
            selectedPath={diffTarget?.kind === 'commit' ? diffTarget.path : null}
            onOpenFile={(file) =>
              setDiffTarget({ kind: 'commit', sha: file.sourceSha ?? selectedCommit, path: file.path, ...(file.oldPath && { oldPath: file.oldPath }) })
            }
            actions={selectedStash && (
              <>
                <span className="stash-label">stash@{`{${selectedStash.index}}`}</span>
                <button type="button" onClick={() => refActions.applyStash(selectedStash.sha)}>
                  Apply
                </button>
                <button type="button" onClick={() => refActions.popStash(selectedStash.sha)}>
                  Pop
                </button>
                <button type="button" className="danger-text" onClick={() => refActions.dropStash(selectedStash.sha, `stash@{${selectedStash.index}}`)}>
                  Delete
                </button>
              </>
            )}
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
                if (change.kind === 'conflicted') {
                  setDiffTarget(null);
                  return setConflictPath(change.path);
                }
                setConflictPath(null);
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
      {refActions.dialogs}
      {menu}
    </main>
  );
}
