import { useState, type MouseEvent, type ReactNode } from 'react';
import type { HistoryFilter } from '../../../shared/history';
import type { ComparisonMode } from '../../../shared/diff';
import type { RepoData } from '../../../shared/state';
import { useCommand } from '../useCommand';
import { copyText, type MenuItem } from './ContextMenu';
import { headLabel, type RefActions } from './useRefActions';
import type { Gitflow } from './useGitflow';
import { flowBranch } from '../../../shared/gitflow';
import { pullTerm, refLabel, type RepoHosting } from '../../../shared/hosting';
import type { HostingItem } from './HostingView';
import { t, translate } from '../../../shared/i18n';

/** The repository's server (when an account matches its remotes): pull requests and issues sections. */
export interface LeftPanelHosting {
  context: RepoHosting;
  /** Changes when the lists should be read again. */
  reloadKey: number;
  selected: HostingItem | null;
  onOpen(item: HostingItem): void;
  onRefresh(): void;
  onCreatePull(): void;
  onCreateIssue(): void;
}

interface LeftPanelProps {
  data: RepoData;
  actions: RefActions;
  gitflow: Gitflow;
  openMenu(event: MouseEvent, items: MenuItem[]): void;
  /** Shows a commit in the graph. */
  onSelectCommit(sha: string): void;
  selectedCommit?: string | null;
  onCompare?(sha: string, mode?: ComparisonMode): void;
  graphFilter: HistoryFilter;
  onFilter(filter: HistoryFilter): void;
  hosting?: LeftPanelHosting | null;
}

type SectionId = 'local' | 'remote' | 'tags' | 'stashes' | 'pulls' | 'issues' | 'submodules' | 'worktrees' | 'gitflow';

const REF_MIME = 'application/x-forklift-ref';

function Section({ id, title, count, collapsed, onToggle, action, children }: {
  id: SectionId;
  title: string;
  count: number;
  collapsed: boolean;
  onToggle(id: SectionId): void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ref-section" aria-label={title} data-section={id}>
      <header className="ref-section-header">
        <button type="button" className="ref-section-toggle" aria-expanded={!collapsed} onClick={() => onToggle(id)}>
          <span className={`codicon ${collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} aria-hidden="true" />
          {title}
          <span className="ref-count">{count}</span>
        </button>
        {action}
      </header>
      {!collapsed && <ul className="ref-list">{children}</ul>}
    </section>
  );
}

/** Left panel as in GitKraken: local branches, remote branches by remote, tags; filter and context actions. */
export function LeftPanel({ data, actions, gitflow, openMenu, onSelectCommit, selectedCommit, onCompare, graphFilter, onFilter, hosting }: LeftPanelProps) {
  const compareItem = (sha: string): MenuItem[] => selectedCommit && selectedCommit !== sha && onCompare
    ? [
        { label: t('Compare with selected commit (A..B)'), onSelect: () => onCompare(sha, 'direct') },
        { label: t('Compare from common ancestor (A...B)'), onSelect: () => onCompare(sha, 'merge-base') },
        'separator',
      ] : [];
  /** Graph filter entries for a ref (full name). */
  const filterItems = (ref: string): MenuItem[] => {
    const hidden = graphFilter.hidden.includes(ref);
    const solo = graphFilter.solo.includes(ref);
    return [
      solo
        ? { label: t('Show all branches in the graph'), onSelect: () => onFilter({ solo: [], hidden: [] }) }
        : { label: t('Show only this in the graph'), onSelect: () => onFilter({ solo: [ref], hidden: [] }) },
      hidden
        ? { label: t('Show in the graph'), onSelect: () => onFilter({ ...graphFilter, hidden: graphFilter.hidden.filter((r) => r !== ref) }) }
        : { label: t('Hide in the graph'), disabled: graphFilter.solo.length > 0, onSelect: () => onFilter({ solo: [], hidden: [...graphFilter.hidden, ref] }) },
    ];
  };
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  const match = (name: string) => name.toLowerCase().includes(filter.trim().toLowerCase());
  const head = data.branch.oid;
  const current = headLabel(data);
  // Merging or rebasing again while an operation waits would only fail.
  const busy = data.operation !== null || !head;

  const local = data.branches.filter((branch) => match(branch.name));
  const remote = data.remoteBranches.filter((branch) => match(branch.name));
  const tags = data.tags.filter((tag) => match(tag.name));
  const stashes = data.stashes.filter((stash) => match(stash.message));
  const submoduleList = useCommand('submodule:list', [data.root], { reloadKey: data.loadedAt, keepPrevious: true });
  const submodules = (submoduleList.data ?? []).filter((submodule) => match(submodule.path));
  const worktreeList = useCommand('worktree:list', [data.root], { reloadKey: data.loadedAt, keepPrevious: true });
  // A single working tree is the repository itself: the section shows once there are linked ones.
  const worktrees = (worktreeList.data ?? []).filter((tree) => match(tree.path) || match(tree.branch ?? ''));
  const flowConfig = gitflow.config;
  const flows = flowConfig ? data.branches.flatMap((branch) => {
    const flow = flowBranch(flowConfig, branch.name);
    return flow && match(branch.name) ? [{ ...flow, branch }] : [];
  }) : [];
  const remotes = data.remotes.length ? data.remotes : [...new Set(data.remoteBranches.map((branch) => branch.remote))];

  /** What dropping branch `dragged` on local branch `target` can do: git merges and rebases the checked-out branch. */
  const dropMenu = (dragged: string, target: string, targetCurrent: boolean): MenuItem[] => {
    const draggedCurrent = data.branches.some((b) => b.current && b.name === dragged);
    if (targetCurrent) {
      return [
        { label: t('Merge {source} into {target}…', { source: dragged, target }), disabled: busy, onSelect: () => actions.merge(dragged, dragged) },
        { label: t('Rebase {source} onto {target}…', { source: target, target: dragged }), disabled: busy, onSelect: () => actions.rebase(dragged, dragged) },
      ];
    }
    if (draggedCurrent) {
      return [
        { label: t('Rebase {source} onto {target}…', { source: dragged, target }), disabled: busy, onSelect: () => actions.rebase(target, target) },
        { label: t('Merge {source} into {target}…', { source: target, target: dragged }), disabled: busy, onSelect: () => actions.merge(target, target) },
      ];
    }
    return [
      { label: t('Check out {target} to merge {source} into it', { target, source: dragged }), onSelect: () => actions.checkout({ kind: 'branch', name: target }) },
    ];
  };

  const addButton = (label: string, onClick: () => void) => (
    <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick} disabled={!head}>
      <span className="codicon codicon-add" aria-hidden="true" />
    </button>
  );

  return (
    <aside className="left-panel" aria-label={t('Branches and tags')}>
      <input className="ref-filter" type="search" placeholder={t('Filter')} aria-label={t('Filter branches and tags')} value={filter} onChange={(event) => setFilter(event.target.value)} />
      <div className="ref-sections">
        <Section
          id="local"
          title={t('Local')}
          count={data.branches.length}
          collapsed={Boolean(collapsed['local'])}
          onToggle={toggle}
          action={head && addButton(t('Create branch'), () => actions.createBranch(head, headLabel(data)))}
        >
          {local.map((branch) => (
            <li
              key={branch.name}
              className={`ref-item${branch.current ? ' current' : ''}${graphFilter.hidden.includes(`refs/heads/${branch.name}`) ? ' hidden-in-graph' : ''}${graphFilter.solo.includes(`refs/heads/${branch.name}`) ? ' solo' : ''}`}
              data-ref={branch.name}
              title={branch.upstream ? `${branch.name} → ${branch.upstream}` : branch.name}
              onClick={(event) => event.ctrlKey || event.metaKey ? onCompare?.(branch.sha) : onSelectCommit(branch.sha)}
              onDoubleClick={() => !branch.current && actions.checkout({ kind: 'branch', name: branch.name })}
              draggable
              onDragStart={(event) => event.dataTransfer.setData(REF_MIME, branch.name)}
              onDragOver={(event) => event.dataTransfer.types.includes(REF_MIME) && event.preventDefault()}
              onDrop={(event) => {
                const dragged = event.dataTransfer.getData(REF_MIME);
                if (!dragged || dragged === branch.name) return;
                event.preventDefault();
                openMenu(event, dropMenu(dragged, branch.name, branch.current));
              }}
              onContextMenu={(event) =>
                openMenu(event, [
                  ...compareItem(branch.sha),
                  { label: t('Check out {branch}', { branch: branch.name }), disabled: branch.current, onSelect: () => actions.checkout({ kind: 'branch', name: branch.name }) },
                  { label: t('Check out in a new working tree…'), disabled: branch.current || (worktreeList.data ?? []).some((tree) => tree.branch === branch.name), onSelect: () => actions.addWorktree(branch.name) },
                  'separator',
                  { label: t('Merge {source} into {target}…', { source: branch.name, target: current }), disabled: branch.current || busy, onSelect: () => actions.merge(branch.name, branch.name) },
                  { label: t('Rebase {source} onto {target}…', { source: current, target: branch.name }), disabled: branch.current || busy, onSelect: () => actions.rebase(branch.name, branch.name) },
                  'separator',
                  { label: t('Create branch here…'), onSelect: () => actions.createBranch(branch.sha, branch.name) },
                  { label: t('Create tag here…'), onSelect: () => actions.createTag(branch.sha, branch.name) },
                  'separator',
                  ...filterItems(`refs/heads/${branch.name}`),
                  'separator',
                  branch.upstream
                    ? { label: t('Change upstream (now {upstream})…', { upstream: branch.upstream }), onSelect: () => actions.setUpstream(branch.name) }
                    : { label: t('Set upstream…'), disabled: data.remoteBranches.length === 0, onSelect: () => actions.setUpstream(branch.name) },
                  ...(branch.upstream ? [{ label: t('Stop tracking {upstream}', { upstream: branch.upstream }), onSelect: () => actions.unsetUpstream(branch.name) }] : []),
                  'separator',
                  { label: t('Rename…'), onSelect: () => actions.renameBranch(branch.name) },
                  { label: t('Delete…'), danger: true, disabled: branch.current, onSelect: () => actions.deleteBranch(branch.name) },
                  'separator',
                  { label: t('Copy branch name'), onSelect: () => copyText(branch.name) },
                ])
              }
            >
              <span className={`codicon ${branch.current ? 'codicon-check' : 'codicon-git-branch'}`} aria-hidden="true" />
              <span className="ref-name">{branch.name}</span>
              {(branch.ahead > 0 || branch.behind > 0) && (
                <span className="ahead-behind-badge" title={t('{ahead} ahead, {behind} behind {upstream}', { ahead: branch.ahead, behind: branch.behind, upstream: branch.upstream ?? '' })}>
                  {branch.ahead > 0 && `↑${branch.ahead}`}
                  {branch.behind > 0 && `↓${branch.behind}`}
                </span>
              )}
            </li>
          ))}
        </Section>

        <Section
          id="remote"
          title={t('Remote')}
          count={data.remoteBranches.length}
          collapsed={Boolean(collapsed['remote'])}
          onToggle={toggle}
          action={
            <button type="button" className="icon-button" aria-label={t('Add remote')} title={t('Add remote')} onClick={actions.addRemote}>
              <span className="codicon codicon-add" aria-hidden="true" />
            </button>
          }
        >
          {remotes.map((name) => {
            const branches = remote.filter((branch) => branch.remote === name);
            const key = `remote:${name}`;
            return (
              <li key={key} className="ref-group">
                <button
                  type="button"
                  className="ref-group-toggle"
                  data-remote={name}
                  title={data.remoteUrls[name]?.fetch ?? name}
                  aria-expanded={!collapsed[key]}
                  onClick={() => toggle(key)}
                  onContextMenu={(event) =>
                    openMenu(event, [
                      { label: t('Fetch {remote}', { remote: name }), onSelect: () => actions.fetchRemote(name) },
                      'separator',
                      { label: t('Edit URL…'), onSelect: () => actions.editRemote(name) },
                      { label: t('Rename…'), onSelect: () => actions.renameRemote(name) },
                      { label: t('Remove…'), danger: true, onSelect: () => actions.removeRemote(name) },
                      'separator',
                      { label: t('Copy URL'), onSelect: () => copyText(data.remoteUrls[name]?.fetch ?? '') },
                    ])
                  }
                >
                  <span className={`codicon ${collapsed[key] ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} aria-hidden="true" />
                  <span className="codicon codicon-cloud" aria-hidden="true" />
                  {name}
                </button>
                {!collapsed[key] && (
                  <ul className="ref-list">
                    {branches.map((branch) => (
                      <li
                        key={branch.name}
                        className="ref-item"
                        data-ref={branch.name}
                        title={branch.name}
                        onClick={(event) => event.ctrlKey || event.metaKey ? onCompare?.(branch.sha) : onSelectCommit(branch.sha)}
                        onDoubleClick={() => actions.checkout({ kind: 'remote', name: branch.name, remote: branch.remote })}
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData(REF_MIME, branch.name)}
                        onContextMenu={(event) =>
                          openMenu(event, [
                            ...compareItem(branch.sha),
                            { label: t('Check out {branch}', { branch: branch.name }), onSelect: () => actions.checkout({ kind: 'remote', name: branch.name, remote: branch.remote }) },
                            ...(data.branch.head ? [{ label: t('Set {remoteBranch} as upstream for {localBranch}', { remoteBranch: branch.name, localBranch: data.branch.head }), disabled: data.branch.upstream === branch.name, onSelect: () => actions.trackCurrentWith(branch.name) }] : []),
                            'separator',
                            { label: t('Merge {source} into {target}…', { source: branch.name, target: current }), disabled: busy, onSelect: () => actions.merge(branch.name, branch.name) },
                            { label: t('Rebase {source} onto {target}…', { source: current, target: branch.name }), disabled: busy, onSelect: () => actions.rebase(branch.name, branch.name) },
                            'separator',
                            { label: t('Create branch here…'), onSelect: () => actions.createBranch(branch.sha, branch.name) },
                            { label: t('Create tag here…'), onSelect: () => actions.createTag(branch.sha, branch.name) },
                            'separator',
                            ...filterItems(`refs/remotes/${branch.name}`),
                            'separator',
                            { label: t('Copy branch name'), onSelect: () => copyText(branch.name) },
                          ])
                        }
                      >
                        <span className="codicon codicon-git-branch" aria-hidden="true" />
                        <span className="ref-name">{branch.name.slice(name.length + 1)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </Section>

        <Section
          id="tags"
          title={t('Tags')}
          count={data.tags.length}
          collapsed={Boolean(collapsed['tags'])}
          onToggle={toggle}
          action={head && addButton(t('Create tag'), () => actions.createTag(head, headLabel(data)))}
        >
          {tags.map((tag) => (
            <li
              key={tag.name}
              className="ref-item"
              data-ref={tag.name}
              title={tag.annotated ? t('{tag} (annotated)', { tag: tag.name }) : tag.name}
              onClick={(event) => event.ctrlKey || event.metaKey ? onCompare?.(tag.sha) : onSelectCommit(tag.sha)}
              onContextMenu={(event) =>
                openMenu(event, [
                  ...compareItem(tag.sha),
                  { label: t('Check out {tag} (detached)', { tag: tag.name }), onSelect: () => actions.checkout({ kind: 'commit', sha: tag.sha }) },
                  { label: t('Create branch here…'), onSelect: () => actions.createBranch(tag.sha, tag.name) },
                  'separator',
                  { label: t('Delete tag…'), danger: true, onSelect: () => actions.deleteTag(tag.name) },
                  'separator',
                  { label: t('Copy tag name'), onSelect: () => copyText(tag.name) },
                ])
              }
            >
              <span className="codicon codicon-tag" aria-hidden="true" />
              <span className="ref-name">{tag.name}</span>
            </li>
          ))}
        </Section>

        <Section
          id="stashes"
          title={t('Stashes')}
          count={data.stashes.length}
          collapsed={Boolean(collapsed['stashes'])}
          onToggle={toggle}
          action={
            <button type="button" className="icon-button" aria-label={t('Stash changes')} title={t('Stash changes')} onClick={actions.stash} disabled={data.changes.length === 0}>
              <span className="codicon codicon-add" aria-hidden="true" />
            </button>
          }
        >
          {stashes.map((stash) => {
            const label = `stash@{${stash.index}}`;
            return (
              <li
                key={stash.sha}
                className="ref-item"
                data-stash={stash.index}
                title={`${label}: ${stash.message}`}
                onClick={() => onSelectCommit(stash.sha)}
                onDoubleClick={() => actions.applyStash(stash.sha)}
                onContextMenu={(event) =>
                  openMenu(event, [
                    { label: t('Apply stash'), onSelect: () => actions.applyStash(stash.sha) },
                    { label: t('Pop stash'), onSelect: () => actions.popStash(stash.sha) },
                    'separator',
                    { label: t('Delete stash…'), danger: true, onSelect: () => actions.dropStash(stash.sha, label) },
                    'separator',
                    { label: t('Copy stash message'), onSelect: () => copyText(stash.message) },
                  ])
                }
              >
                <span className="codicon codicon-archive" aria-hidden="true" />
                <span className="ref-name">{stash.message.replace(/^(WIP on|On) [^:]+: /, '')}</span>
              </li>
            );
          })}
        </Section>

        {hosting && <HostingSections hosting={hosting} repo={data.root} collapsed={collapsed} onToggle={toggle} match={match} openMenu={openMenu} />}

        <Section
          id="submodules"
          title={t('Submodules')}
          count={submoduleList.data?.length ?? 0}
          collapsed={Boolean(collapsed['submodules'])}
          onToggle={toggle}
          action={
            <button type="button" className="icon-button" aria-label={t('Add a submodule')} title={t('Add a submodule')} onClick={actions.addSubmodule}>
              <span className="codicon codicon-add" aria-hidden="true" />
            </button>
          }
        >
          {submodules.map((submodule) => {
            const ready = submodule.state !== 'uninitialized';
            const note = { uninitialized: t('not initialized'), current: '', moved: t('at another commit'), conflict: t('conflict') }[submodule.state];
            return (
              <li
                key={submodule.path}
                className={`ref-item submodule ${submodule.state}`}
                data-submodule={submodule.path}
                title={t('{path} — {url}{note}{dirty}', { path: submodule.path, url: submodule.url, note: note ? ` (${note})` : '', dirty: submodule.dirty ? t(', changed inside') : '' })}
                onDoubleClick={() => (ready ? actions.openSubmodule(submodule.path) : actions.updateSubmodules(submodule.path))}
                onContextMenu={(event) =>
                  openMenu(event, [
                    { label: t('Open in a new tab'), disabled: !ready, onSelect: () => actions.openSubmodule(submodule.path) },
                    { label: ready ? t('Update') : t('Initialize and update'), onSelect: () => actions.updateSubmodules(submodule.path) },
                    { label: t('Update all submodules'), onSelect: () => actions.updateSubmodules(null) },
                    { label: t('Sync URLs from .gitmodules'), onSelect: actions.syncSubmodules },
                    'separator',
                    { label: t('Copy path'), onSelect: () => copyText(submodule.path) },
                    { label: t('Copy URL'), onSelect: () => copyText(submodule.url) },
                    'separator',
                    { label: t('Remove submodule…'), danger: true, onSelect: () => actions.removeSubmodule(submodule.path) },
                  ])
                }
              >
                <span className={`codicon ${ready ? 'codicon-file-submodule' : 'codicon-cloud-download'}`} aria-hidden="true" />
                <span className="ref-name">{submodule.path}</span>
                {(note || submodule.dirty) && <span className="submodule-state">{[note, submodule.dirty && t('changed')].filter(Boolean).join(', ')}</span>}
              </li>
            );
          })}
        </Section>

        <Section
          id="gitflow"
          title={t('Gitflow')}
          count={flows.length}
          collapsed={Boolean(collapsed['gitflow'])}
          onToggle={toggle}
          action={
            flowConfig ? (
              <button
                type="button"
                className="icon-button"
                aria-label={t('Start a feature, release or hotfix')}
                title={t('Start a feature, release or hotfix')}
                onClick={(event) =>
                  openMenu(event, [
                    { label: t('Start a feature…'), onSelect: () => gitflow.start('feature') },
                    { label: t('Start a release…'), onSelect: () => gitflow.start('release') },
                    { label: t('Start a hotfix…'), onSelect: () => gitflow.start('hotfix') },
                    'separator',
                    { label: t('Gitflow settings…'), onSelect: gitflow.init },
                  ])
                }
              >
                <span className="codicon codicon-add" aria-hidden="true" />
              </button>
            ) : undefined
          }
        >
          {flowConfig === null && (
            <li className="ref-item gitflow-setup">
              <button type="button" className="link-button" onClick={gitflow.init}>
                {t('Set up Gitflow…')}
              </button>
            </li>
          )}
          {flows.map(({ kind, name, branch }) => (
            <li
              key={branch.name}
              className={`ref-item gitflow ${kind}${branch.current ? ' current' : ''}`}
              data-flow={branch.name}
              title={branch.name}
              onClick={() => onSelectCommit(branch.sha)}
              onDoubleClick={() => !branch.current && actions.checkout({ kind: 'branch', name: branch.name })}
              onContextMenu={(event) =>
                openMenu(event, [
                  { label: t('Finish {kind} {name}…', { kind, name }), onSelect: () => gitflow.finish(branch.name) },
                  { label: t('Check out {branch}', { branch: branch.name }), disabled: branch.current, onSelect: () => actions.checkout({ kind: 'branch', name: branch.name }) },
                  'separator',
                  { label: t('Delete…'), danger: true, disabled: branch.current, onSelect: () => actions.deleteBranch(branch.name) },
                ])
              }
            >
              <span className={`codicon ${kind === 'feature' ? 'codicon-sparkle' : kind === 'release' ? 'codicon-rocket' : 'codicon-flame'}`} aria-hidden="true" />
              <span className="ref-name">{name}</span>
              <span className="submodule-state">{translate(`flow|${kind}`)}</span>
            </li>
          ))}
        </Section>

        <Section
          id="worktrees"
          title={t('Worktrees')}
          count={worktreeList.data?.length ?? 0}
          collapsed={Boolean(collapsed['worktrees'])}
          onToggle={toggle}
          action={
            <button type="button" className="icon-button" aria-label={t('Add a working tree')} title={t('Add a working tree')} onClick={() => actions.addWorktree()}>
              <span className="codicon codicon-add" aria-hidden="true" />
            </button>
          }
        >
          {worktrees.map((tree) => {
            const name = tree.path.split(/[\\/]/).filter(Boolean).pop() ?? tree.path;
            const note = [tree.current && t('this tab'), tree.main && t('worktree|main'), tree.locked !== null && t('locked'), tree.prunable && t('missing')].filter(Boolean).join(', ');
            return (
              <li
                key={tree.path}
                className={`ref-item worktree${tree.current ? ' current' : ''}${tree.prunable ? ' prunable' : ''}`}
                data-worktree={tree.path}
                title={t('{path}{ref}{lock}', {
                  path: tree.path,
                  ref: tree.branch ? ` — ${tree.branch}` : tree.head ? ` — ${t('detached at {sha}', { sha: tree.head.slice(0, 7) })}` : '',
                  lock: tree.locked ? ` (${t('locked: {reason}', { reason: tree.locked })})` : '',
                })}
                onDoubleClick={() => !tree.current && !tree.prunable && !tree.bare && actions.openWorktree(tree.path)}
                onContextMenu={(event) =>
                  openMenu(event, [
                    { label: t('Open in a new tab'), disabled: tree.current || tree.prunable || tree.bare, onSelect: () => actions.openWorktree(tree.path) },
                    'separator',
                    tree.locked === null
                      ? { label: t('Lock'), disabled: tree.main, onSelect: () => actions.lockWorktree(tree.path, true) }
                      : { label: t('Unlock'), onSelect: () => actions.lockWorktree(tree.path, false) },
                    { label: t('Prune missing working trees'), onSelect: actions.pruneWorktrees },
                    'separator',
                    { label: t('Copy path'), onSelect: () => copyText(tree.path) },
                    'separator',
                    { label: t('Remove working tree…'), danger: true, disabled: tree.main || tree.current || tree.locked !== null, onSelect: () => actions.removeWorktree(tree.path) },
                  ])
                }
              >
                <span className={`codicon ${tree.prunable ? 'codicon-warning' : tree.current ? 'codicon-check' : 'codicon-folder'}`} aria-hidden="true" />
                <span className="ref-name">{tree.branch ?? name}</span>
                <span className="submodule-state">{note || name}</span>
              </li>
            );
          })}
        </Section>
      </div>
    </aside>
  );
}

function HostingSections({ hosting, repo, collapsed, onToggle, match, openMenu }: {
  hosting: LeftPanelHosting;
  repo: string;
  collapsed: Record<string, boolean>;
  onToggle(id: SectionId): void;
  match(text: string): boolean;
  openMenu(event: MouseEvent, items: MenuItem[]): void;
}) {
  const pulls = useCommand('hosting:pulls', [repo, 'open'], { reloadKey: hosting.reloadKey, keepPrevious: true });
  const issues = useCommand('hosting:issues', [repo, 'open'], { reloadKey: hosting.reloadKey, keepPrevious: true });
  const server = new URL(hosting.context.account.url).host;
  // GitLab says merge request; whole messages, since Russian does not pluralize by an appended "s".
  const merge = pullTerm(hosting.context.account.provider) === 'Merge request';
  const buttons = (create: string, onCreate: () => void) => (
    <span className="ref-section-actions">
      <button type="button" className="icon-button" aria-label={t('Refresh from {server}', { server })} title={t('Refresh from {server}', { server })} onClick={hosting.onRefresh}>
        <span className="codicon codicon-refresh" aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" aria-label={create} title={create} onClick={onCreate}>
        <span className="codicon codicon-add" aria-hidden="true" />
      </button>
    </span>
  );
  const item = (kind: HostingItem['kind'], entry: { number: number; title: string; author: string; webUrl: string }, icon: string, note: string) => {
    const selected = hosting.selected?.kind === kind && hosting.selected.number === entry.number;
    const label = refLabel(hosting.context.account.provider, kind, entry.number);
    return (
      <li
        key={entry.number}
        className={`ref-item hosting-item${selected ? ' current' : ''}`}
        data-hosting={`${kind}-${entry.number}`}
        title={`${label} ${entry.title} — ${entry.author}`}
        onClick={() => hosting.onOpen({ kind, number: entry.number })}
        onContextMenu={(event) =>
          openMenu(event, [
            { label: t('Show'), onSelect: () => hosting.onOpen({ kind, number: entry.number }) },
            { label: t('Copy link'), onSelect: () => copyText(entry.webUrl) },
            { label: t('Copy number'), onSelect: () => copyText(label) },
          ])
        }
      >
        <span className={`codicon codicon-${icon}`} aria-hidden="true" />
        <span className="ref-name">
          <span className="hosting-number">{label}</span> {entry.title}
        </span>
        {note && <span className="submodule-state">{note}</span>}
      </li>
    );
  };
  const error = (text: string | null) => text && <li className="ref-error setting-error" title={text}>{text}</li>;
  return (
    <>
      <Section id="pulls" title={merge ? t('Merge requests') : t('Pull requests')} count={pulls.data?.length ?? 0} collapsed={Boolean(collapsed['pulls'])} onToggle={onToggle} action={buttons(merge ? t('Create a merge request') : t('Create a pull request'), hosting.onCreatePull)}>
        {error(pulls.error)}
        {pulls.data?.filter((pull) => match(`${pull.number} ${pull.title} ${pull.head}`)).map((pull) => item('pull', pull, 'git-pull-request', pull.draft ? t('draft') : pull.head))}
        {pulls.data?.length === 0 && <li className="empty-note">{merge ? t('No open merge requests') : t('No open pull requests')}</li>}
      </Section>
      <Section id="issues" title={t('Issues')} count={issues.data?.length ?? 0} collapsed={Boolean(collapsed['issues'])} onToggle={onToggle} action={buttons(t('Create an issue'), hosting.onCreateIssue)}>
        {error(issues.error)}
        {issues.data?.filter((issue) => match(`${issue.number} ${issue.title}`)).map((issue) => item('issue', issue, 'issues', issue.labels.map((label) => label.name).join(', ')))}
        {issues.data?.length === 0 && <li className="empty-note">{t('No open issues')}</li>}
      </Section>
    </>
  );
}
