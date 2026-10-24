import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LIMITS, resetPanelWidth, setPanelWidth, togglePanel, useLayout } from '../layout';
import { Splitter } from './Splitter';
import { NO_FILTER, type HistoryFilter } from '../../../shared/history';
import { useCommand } from '../useCommand';
import { HistoryBar, type SearchState } from './HistoryBar';
import type { DiffTarget } from '../../../shared/diff';
import type { FileChange, RepoData } from '../../../shared/state';
import { useCommandHandlers } from '../commands';
import { FinderPalette } from './FinderPalette';
import { BranchSwitcher } from './BranchSwitcher';
import { LfsDialog } from './LfsDialog';
import { useGitflow } from './useGitflow';
import { flowBranch } from '../../../shared/gitflow';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { ChangesPanel } from './ChangesPanel';
import { CommitDetailsPanel } from './CommitDetailsPanel';
import { CommitGraph } from './CommitGraph';
import { ConflictView } from './ConflictView';
import { FileHistoryView } from './FileHistoryView';
import { InteractiveRebaseView } from './InteractiveRebaseView';
import { OperationBanner } from './OperationBanner';
import { copyText, useContextMenu } from './ContextMenu';
import { LeftPanel } from './LeftPanel';
import { useRefActions } from './useRefActions';
import { CommitPanel } from './CommitPanel';
import { useConfirm } from './ConfirmDialog';
import { DiffView, type DiffEditing } from './DiffView';
import { useFormDialog } from './FormDialog';
import { HostingView, type HostingItem } from './HostingView';
import { useAppState } from '../state';
import { pullTerm } from '../../../shared/hosting';

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
  const [rebaseBase, setRebaseBase] = useState<string | null>(null);
  const [fileHistory, setFileHistory] = useState<{ path: string; mode: 'history' | 'blame' } | null>(null);
  const [hostingItem, setHostingItem] = useState<HostingItem | null>(null);
  const [hostingReload, setHostingReload] = useState(0);
  const accountIds = useAppState((s) => s.settings.values['integrations.accounts'].map((account) => account.id).join(','));
  // The repository's server, when one of Preferences → Integrations matches its remotes.
  const hostingContext = useCommand(accountIds ? 'hosting:context' : null, [repo], { reloadKey: JSON.stringify([data.remoteUrls, accountIds]), keepPrevious: true });
  const hosting = accountIds ? (hostingContext.data ?? null) : null;
  const { form: openForm, dialog: formDialog } = useFormDialog();
  const [filter, setFilterState] = useState<HistoryFilter>(() => loadFilter(data.root));
  const setFilter = (next: HistoryFilter) => {
    setFilterState(next);
    saveFilter(data.root, next);
  };
  const [search, setSearchState] = useState<SearchState>({ open: false, field: 'message', text: '' });
  const [query, setQuery] = useState(search);
  // -1: results shown but none visited yet; the first Enter goes to the first match.
  const [matchIndex, setMatchIndex] = useState(-1);
  const [reveal, setReveal] = useState<{ index: number; nonce: number } | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setSearch = (next: SearchState) => {
    setSearchState(next);
    setMatchIndex(-1);
    // Searching waits for a pause in typing.
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQuery(next), next.text === search.text ? 0 : 250);
  };
  const searching = query.open && query.text.trim() !== '';
  const found = useCommand(searching ? 'history:search' : null, [repo, data.historyVersion, filter, { field: query.field, text: query.text }]);
  const matches = useMemo(() => new Set(found.data?.indices ?? []), [found.data]);
  const nonce = useRef(0);
  const revealIndex = (index: number) => setReveal({ index, nonce: ++nonce.current });
  const step = (direction: 1 | -1) => {
    const indices = found.data?.indices ?? [];
    if (!indices.length) return;
    const next = matchIndex < 0 ? (direction === 1 ? 0 : indices.length - 1) : (matchIndex + direction + indices.length) % indices.length;
    setMatchIndex(next);
    revealIndex(indices[next]!);
  };
  /** Selects a commit and scrolls to it, wherever it is in the history. */
  const showCommit = (sha: string) => {
    setSelectedCommit(sha);
    void invoke('history:locate', repo, data.historyVersion, filter, sha).then((index) => index >= 0 && revealIndex(index));
  };

  const { confirm, dialog } = useConfirm();
  const refActions = useRefActions(repo, data, run);
  const gitflow = useGitflow(repo, data);
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

  const openChange = (change: FileChange, staged: boolean) => {
    setFileHistory(null);
    setHostingItem(null);
    if (change.kind === 'conflicted') {
      setDiffTarget(null);
      return setConflictPath(change.path);
    }
    setConflictPath(null);
    // A rename already in the index is under its new name there, so the unstaged side needs no old path.
    const oldPath = staged || !change.staged ? change.origPath : undefined;
    setDiffTarget({ kind: 'worktree', path: change.path, staged, ...(oldPath && { oldPath }) });
  };

  const layout = useLayout();
  const [finding, setFinding] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [lfsOpen, setLfsOpen] = useState(false);
  const [lfsWarningHidden, setLfsWarningHidden] = useState(false);
  const lfsInfo = useCommand('lfs:info', [repo, data.changes.slice(0, 2000).map((c) => c.path)], { reloadKey: data.loadedAt, keepPrevious: true });
  const lfsPaths = useMemo(() => new Set(lfsInfo.data?.paths ?? []), [lfsInfo.data]);
  const lfsMissing = Boolean(lfsInfo.data && lfsInfo.data.patterns.length > 0 && !lfsInfo.data.installed);
  const head = data.branch.oid;
  const centerFree = !fileHistory && !rebaseBase && !conflictPath && !diffTarget && !hostingItem;
  const openHosting = useCallback((item: HostingItem) => {
    setFileHistory(null);
    setDiffTarget(null);
    setConflictPath(null);
    setHostingItem(item);
  }, []);
  const closeHosting = useCallback(() => setHostingItem(null), []);

  const createPull = () => {
    if (!hosting || !data.branch.head) return;
    const remote = hosting.remote;
    const term = pullTerm(hosting.account.provider);
    // The branch's name on the server: its upstream there, or the same name.
    const upstream = data.branch.upstream;
    const pushed = upstream?.startsWith(`${remote}/`) ? upstream.slice(remote.length + 1) : data.branch.head;
    const unpushed = !upstream?.startsWith(`${remote}/`) ? `${data.branch.head} is not on ${remote} yet: push it first.` : data.branch.ahead > 0 ? `${data.branch.ahead} commit(s) of ${data.branch.head} are not pushed yet; the ${term.toLowerCase()} will only have what is on ${remote}.` : null;
    const bases = [...new Set([hosting.defaultBranch, ...data.remoteBranches.filter((branch) => branch.remote === remote).map((branch) => branch.name.slice(remote.length + 1)).filter((name) => name !== 'HEAD' && name !== pushed)])];
    void openForm({
      title: `${term} from ${pushed}`,
      detail: `${hosting.owner}/${hosting.name} on ${new URL(hosting.account.url).host}${unpushed ? `. ${unpushed}` : ''}`,
      fields: [
        { name: 'title', label: 'Title', initial: pushed.replace(/^[\w-]+\//, '').replace(/[-_]+/g, ' ') },
        { name: 'base', label: 'Into', type: 'select', options: bases.map((name) => ({ value: name, label: name })), initial: hosting.defaultBranch },
        { name: 'body', label: 'Description', type: 'textarea' },
      ],
      confirmLabel: `Create ${term.toLowerCase()}`,
      validate: async (values) => (String(values['title']).trim() ? null : 'A title is needed'),
      submit: async (values) => {
        try {
          const pull = await invoke('hosting:createPull', repo, { head: pushed, base: String(values['base']), title: String(values['title']).trim(), body: String(values['body']) });
          setHostingReload((n) => n + 1);
          openHosting({ kind: 'pull', number: pull.number });
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    });
  };

  const createIssue = () => {
    if (!hosting) return;
    void openForm({
      title: 'New issue',
      detail: `${hosting.owner}/${hosting.name} on ${new URL(hosting.account.url).host}`,
      fields: [
        { name: 'title', label: 'Title' },
        { name: 'body', label: 'Description', type: 'textarea' },
      ],
      confirmLabel: 'Create issue',
      validate: async (values) => (String(values['title']).trim() ? null : 'A title is needed'),
      submit: async (values) => {
        try {
          const issue = await invoke('hosting:createIssue', repo, { title: String(values['title']).trim(), body: String(values['body']) });
          setHostingReload((n) => n + 1);
          openHosting({ kind: 'issue', number: issue.number });
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    });
  };
  const unstagedPaths = data.changes.filter((c) => c.unstaged).map((c) => c.path);
  const stagedPaths = data.changes.filter((c) => c.staged).map((c) => c.path);
  useCommandHandlers({
    'palette.find': { run: () => setFinding(true) },
    'view.toggleLeftPanel': { run: () => togglePanel('left') },
    'view.toggleRightPanel': { run: () => togglePanel('right') },
    'branch.switch': { run: () => setSwitchingBranch(true) },
    'branch.setUpstream': { run: () => data.branch.head && refActions.setUpstream(data.branch.head), enabled: () => Boolean(data.branch.head) },
    'repo.stageAll': { run: () => void run(() => invoke('index:stage', repo, unstagedPaths)), enabled: () => unstagedPaths.length > 0 },
    'repo.unstageAll': { run: () => void run(() => invoke('index:unstage', repo, stagedPaths)), enabled: () => stagedPaths.length > 0 },
    'repo.discardAll': { run: () => void discardFiles(data.changes.map((c) => c.path)), enabled: () => data.changes.length > 0 && data.operation === null },
    'repo.focusCommit': {
      run: () => {
        setSelectedCommit(null);
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.commit-summary')?.focus());
      },
    },
    'repo.createBranch': { run: () => head && refActions.createBranch(head, data.branch.head ?? head.slice(0, 7)), enabled: () => Boolean(head) },
    'repo.createTag': { run: () => head && refActions.createTag(head, data.branch.head ?? head.slice(0, 7)), enabled: () => Boolean(head) },
    'history.search': {
      run: () => setSearchState((current) => ({ ...current, open: true })),
      // The diff and conflict editors have their own find.
      enabled: () => centerFree && !document.activeElement?.closest('.monaco-editor'),
    },
    'history.goToHead': { run: () => head && showCommit(head), enabled: () => Boolean(head) },
    'history.showAll': { run: () => setFilter(NO_FILTER), enabled: () => filter.solo.length > 0 || filter.hidden.length > 0 },
    'gitflow.init': { run: gitflow.init },
    'gitflow.feature': { run: () => gitflow.start('feature'), enabled: () => Boolean(gitflow.config) },
    'gitflow.release': { run: () => gitflow.start('release'), enabled: () => Boolean(gitflow.config) },
    'gitflow.hotfix': { run: () => gitflow.start('hotfix'), enabled: () => Boolean(gitflow.config) },
    'gitflow.finish': {
      run: () => data.branch.head && gitflow.finish(data.branch.head),
      enabled: () => Boolean(gitflow.config && data.branch.head && flowBranch(gitflow.config, data.branch.head)),
    },
    'hosting.createPull': { run: createPull, enabled: () => Boolean(hosting && data.branch.head) },
    'hosting.createIssue': { run: createIssue, enabled: () => Boolean(hosting) },
    'hosting.showPulls': {
      run: () => {
        if (layout.leftHidden) togglePanel('left');
        requestAnimationFrame(() => document.querySelector('.ref-section[data-section="pulls"]')?.scrollIntoView({ block: 'start' }));
      },
      enabled: () => Boolean(hosting),
    },
    'lfs.manage': { run: () => setLfsOpen(true) },
    'lfs.pull': { run: () => void run(() => invoke('lfs:download', repo, true)), enabled: () => Boolean(lfsInfo.data?.installed) },
    'lfs.fetch': { run: () => void run(() => invoke('lfs:download', repo, false)), enabled: () => Boolean(lfsInfo.data?.installed) },
  });

  const stagedCount = data.changes.filter((c) => c.staged).length;
  const selectedStash = data.stashes.find((stash) => stash.sha === selectedCommit) ?? null;

  return (
    <main
      className="workspace"
      style={{ '--left': layout.leftHidden ? '0px' : `${layout.left}px`, '--right': layout.rightHidden ? '0px' : `${layout.right}px` } as CSSProperties}
    >
      {layout.leftHidden ? <div /> : <LeftPanel
          data={data}
          actions={refActions}
          gitflow={gitflow}
          openMenu={openMenu}
          onSelectCommit={showCommit}
          graphFilter={filter}
          onFilter={setFilter}
          hosting={hosting && { context: hosting, reloadKey: hostingReload, selected: hostingItem, onOpen: openHosting, onRefresh: () => setHostingReload((n) => n + 1), onCreatePull: createPull, onCreateIssue: createIssue }}
        />}
      <Splitter label="Resize the left panel" className="left" value={layout.leftHidden ? 0 : layout.left} min={LIMITS.left[0]} max={LIMITS.left[1]} direction={1} onChange={(width) => setPanelWidth('left', width)} onReset={() => resetPanelWidth('left')} />
      <div className="center">
      <OperationBanner repo={repo} data={data} run={run} />
      {lfsMissing && !lfsWarningHidden && (
        <div className="error-banner notices lfs-missing" role="alert">
          This repository uses Git LFS, but git-lfs is not installed: LFS files show as pointers, and new ones would be committed as normal files. Install it from https://git-lfs.com and run “git lfs install” once.
          <button type="button" onClick={() => setLfsWarningHidden(true)}>
            Dismiss
          </button>
        </div>
      )}
      {hostingItem && hosting ? (
        <HostingView
          key={`${hostingItem.kind}-${hostingItem.number}`}
          repo={repo}
          hosting={hosting}
          item={hostingItem}
          onChanged={() => setHostingReload((n) => n + 1)}
          onOpen={openHosting}
          onShowCommit={(sha) => {
            setHostingItem(null);
            showCommit(sha);
          }}
          run={run}
          onClose={closeHosting}
        />
      ) : fileHistory ? (
        <FileHistoryView
          key={fileHistory.path}
          repo={repo}
          path={fileHistory.path}
          mode={fileHistory.mode}
          onMode={(mode) => setFileHistory({ ...fileHistory, mode })}
          onShowCommit={(sha) => {
            setFileHistory(null);
            showCommit(sha);
          }}
          onClose={() => setFileHistory(null)}
        />
      ) : rebaseBase ? (
        <InteractiveRebaseView key={rebaseBase} repo={repo} base={rebaseBase} branch={data.branch.head ?? 'HEAD'} run={run} onClose={() => setRebaseBase(null)} />
      ) : conflictPath ? (
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
        <>
        <HistoryBar
          filter={filter}
          onShowAll={() => setFilter(NO_FILTER)}
          onGoToHead={() => data.branch.oid && showCommit(data.branch.oid)}
          search={search}
          onSearch={setSearch}
          results={searching ? (found.data ? { count: found.data.indices.length, truncated: found.data.truncated } : null) : null}
          current={Math.max(0, matchIndex)}
          onStep={step}
          error={found.error}
        />
        <CommitGraph
          repo={repo}
          data={data}
          filter={filter}
          matches={searching && found.data ? matches : undefined}
          reveal={reveal}
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
              { label: `Merge this commit into ${data.branch.head ?? 'HEAD'}…`, disabled: isHead || busy, onSelect: () => refActions.merge(row.hash, short) },
              { label: `Rebase ${data.branch.head ?? 'HEAD'} onto this commit…`, disabled: isHead || busy, onSelect: () => refActions.rebase(row.hash, short) },
              { label: `Interactive rebase ${data.branch.head ?? 'HEAD'} from here…`, disabled: isHead || busy, onSelect: () => setRebaseBase(row.hash) },
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
        </>
      )}
      </div>
      <Splitter label="Resize the right panel" className="right" value={layout.rightHidden ? 0 : layout.right} min={LIMITS.right[0]} max={LIMITS.right[1]} direction={-1} onChange={(width) => setPanelWidth('right', width)} onReset={() => resetPanelWidth('right')} />
      <aside className="side" hidden={layout.rightHidden}>
        {selectedCommit ? (
          <CommitDetailsPanel
            key={selectedCommit}
            repo={repo}
            sha={selectedCommit}
            selectedPath={diffTarget?.kind === 'commit' ? diffTarget.path : null}
            onOpenFile={(file) =>
              setDiffTarget({ kind: 'commit', sha: file.sourceSha ?? selectedCommit, path: file.path, ...(file.oldPath && { oldPath: file.oldPath }) })
            }
            onFileHistory={(path) => setFileHistory({ path, mode: 'history' })}
            onOpenRef={hosting ? openHosting : undefined}
            provider={hosting?.account.provider}
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
              onShowDiff={openChange}
              lfsPaths={lfsPaths}
              onStage={(paths) => void run(() => invoke('index:stage', repo, paths))}
              onUnstage={(paths) => void run(() => invoke('index:unstage', repo, paths))}
              onDiscard={(paths) => void discardFiles(paths)}
              onOpenInEditor={(path) => void run(() => invoke('file:openInEditor', repo, path))}
              onExternalDiff={(path, staged) => void runInBackground(() => invoke('file:externalDiff', repo, path, staged))}
              onExternalMerge={(path) => void runInBackground(() => invoke('file:externalMerge', repo, path))}
              onFileHistory={(path) => setFileHistory({ path, mode: 'history' })}
            />
            <CommitPanel
              // A new prepared message (a merge or squash started) restarts the form with it.
              key={data.preparedMessage ?? ''}
              preparedMessage={data.preparedMessage}
              repo={repo}
              stagedCount={stagedCount}
              headSha={data.branch.oid}
              loadedAt={data.loadedAt}
              onCommit={(message, amend, skipHooks) => run(() => invoke('commit:create', repo, message, amend, { skipHooks }))}
            />
          </>
        )}
      </aside>
      {dialog}
      {formDialog}
      {refActions.dialogs}
      {gitflow.dialogs}
      {menu}
      {switchingBranch && (
        <BranchSwitcher
          data={data}
          onClose={() => setSwitchingBranch(false)}
          onCheckout={refActions.checkout}
          onCreate={() => head && refActions.createBranch(head, data.branch.head ?? head.slice(0, 7))}
        />
      )}
      {lfsOpen && <LfsDialog repo={repo} info={lfsInfo.data} onClose={() => setLfsOpen(false)} />}
      {finding && (
        <FinderPalette
          data={data}
          filter={filter}
          onClose={() => setFinding(false)}
          onShowCommit={(sha) => {
            setFileHistory(null);
            setHostingItem(null);
            setDiffTarget(null);
            setConflictPath(null);
            showCommit(sha);
          }}
          onCheckout={refActions.checkout}
          onOpenChange={(change) => {
            setSelectedCommit(null);
            openChange(change, !change.unstaged);
          }}
          onFileHistory={(path) => setFileHistory({ path, mode: 'history' })}
        />
      )}
    </main>
  );
}

const FILTER_KEY = (root: string) => `forklift.historyFilter:${root}`;

/** The branch filter is a view preference of this window, kept per repository. */
function loadFilter(root: string): HistoryFilter {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTER_KEY(root)) ?? 'null') as HistoryFilter | null;
    if (raw && Array.isArray(raw.solo) && Array.isArray(raw.hidden)) return { solo: raw.solo, hidden: raw.hidden };
  } catch {
    // unavailable storage: no filter
  }
  return NO_FILTER;
}

function saveFilter(root: string, filter: HistoryFilter) {
  try {
    if (filter.solo.length || filter.hidden.length) localStorage.setItem(FILTER_KEY(root), JSON.stringify(filter));
    else localStorage.removeItem(FILTER_KEY(root));
  } catch {
    // storage unavailable: the filter lasts for this session
  }
}
