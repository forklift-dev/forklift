import { useState, type MouseEvent, type ReactNode } from 'react';
import type { HistoryFilter } from '../../../shared/history';
import type { RepoData } from '../../../shared/state';
import { useCommand } from '../useCommand';
import { copyText, type MenuItem } from './ContextMenu';
import { headLabel, type RefActions } from './useRefActions';
import type { Gitflow } from './useGitflow';
import { flowBranch } from '../../../shared/gitflow';

interface LeftPanelProps {
  data: RepoData;
  actions: RefActions;
  gitflow: Gitflow;
  openMenu(event: MouseEvent, items: MenuItem[]): void;
  /** Shows a commit in the graph. */
  onSelectCommit(sha: string): void;
  graphFilter: HistoryFilter;
  onFilter(filter: HistoryFilter): void;
}

type SectionId = 'local' | 'remote' | 'tags' | 'stashes' | 'submodules' | 'worktrees' | 'gitflow';

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
    <section className="ref-section" aria-label={title}>
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
export function LeftPanel({ data, actions, gitflow, openMenu, onSelectCommit, graphFilter, onFilter }: LeftPanelProps) {
  /** Graph filter entries for a ref (full name). */
  const filterItems = (ref: string): MenuItem[] => {
    const hidden = graphFilter.hidden.includes(ref);
    const solo = graphFilter.solo.includes(ref);
    return [
      solo
        ? { label: 'Show all branches in the graph', onSelect: () => onFilter({ solo: [], hidden: [] }) }
        : { label: 'Show only this in the graph', onSelect: () => onFilter({ solo: [ref], hidden: [] }) },
      hidden
        ? { label: 'Show in the graph', onSelect: () => onFilter({ ...graphFilter, hidden: graphFilter.hidden.filter((r) => r !== ref) }) }
        : { label: 'Hide in the graph', disabled: graphFilter.solo.length > 0, onSelect: () => onFilter({ solo: [], hidden: [...graphFilter.hidden, ref] }) },
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
        { label: `Merge ${dragged} into ${target}…`, disabled: busy, onSelect: () => actions.merge(dragged, dragged) },
        { label: `Rebase ${target} onto ${dragged}…`, disabled: busy, onSelect: () => actions.rebase(dragged, dragged) },
      ];
    }
    if (draggedCurrent) {
      return [
        { label: `Rebase ${dragged} onto ${target}…`, disabled: busy, onSelect: () => actions.rebase(target, target) },
        { label: `Merge ${target} into ${dragged}…`, disabled: busy, onSelect: () => actions.merge(target, target) },
      ];
    }
    return [
      { label: `Check out ${target} to merge ${dragged} into it`, onSelect: () => actions.checkout({ kind: 'branch', name: target }) },
    ];
  };

  const addButton = (label: string, onClick: () => void) => (
    <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick} disabled={!head}>
      <span className="codicon codicon-add" aria-hidden="true" />
    </button>
  );

  return (
    <aside className="left-panel" aria-label="Branches and tags">
      <input className="ref-filter" type="search" placeholder="Filter" aria-label="Filter branches and tags" value={filter} onChange={(event) => setFilter(event.target.value)} />
      <div className="ref-sections">
        <Section
          id="local"
          title="Local"
          count={data.branches.length}
          collapsed={Boolean(collapsed['local'])}
          onToggle={toggle}
          action={head && addButton('Create branch', () => actions.createBranch(head, headLabel(data)))}
        >
          {local.map((branch) => (
            <li
              key={branch.name}
              className={`ref-item${branch.current ? ' current' : ''}${graphFilter.hidden.includes(`refs/heads/${branch.name}`) ? ' hidden-in-graph' : ''}${graphFilter.solo.includes(`refs/heads/${branch.name}`) ? ' solo' : ''}`}
              data-ref={branch.name}
              title={branch.upstream ? `${branch.name} → ${branch.upstream}` : branch.name}
              onClick={() => onSelectCommit(branch.sha)}
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
                  { label: `Check out ${branch.name}`, disabled: branch.current, onSelect: () => actions.checkout({ kind: 'branch', name: branch.name }) },
                  { label: 'Check out in a new working tree…', disabled: branch.current || (worktreeList.data ?? []).some((tree) => tree.branch === branch.name), onSelect: () => actions.addWorktree(branch.name) },
                  'separator',
                  { label: `Merge ${branch.name} into ${current}…`, disabled: branch.current || busy, onSelect: () => actions.merge(branch.name, branch.name) },
                  { label: `Rebase ${current} onto ${branch.name}…`, disabled: branch.current || busy, onSelect: () => actions.rebase(branch.name, branch.name) },
                  'separator',
                  { label: 'Create branch here…', onSelect: () => actions.createBranch(branch.sha, branch.name) },
                  { label: 'Create tag here…', onSelect: () => actions.createTag(branch.sha, branch.name) },
                  'separator',
                  ...filterItems(`refs/heads/${branch.name}`),
                  'separator',
                  { label: 'Rename…', onSelect: () => actions.renameBranch(branch.name) },
                  { label: 'Delete…', danger: true, disabled: branch.current, onSelect: () => actions.deleteBranch(branch.name) },
                  'separator',
                  { label: 'Copy branch name', onSelect: () => copyText(branch.name) },
                ])
              }
            >
              <span className={`codicon ${branch.current ? 'codicon-check' : 'codicon-git-branch'}`} aria-hidden="true" />
              <span className="ref-name">{branch.name}</span>
              {(branch.ahead > 0 || branch.behind > 0) && (
                <span className="ahead-behind-badge" title={`${branch.ahead} ahead, ${branch.behind} behind ${branch.upstream}`}>
                  {branch.ahead > 0 && `↑${branch.ahead}`}
                  {branch.behind > 0 && `↓${branch.behind}`}
                </span>
              )}
            </li>
          ))}
        </Section>

        <Section
          id="remote"
          title="Remote"
          count={data.remoteBranches.length}
          collapsed={Boolean(collapsed['remote'])}
          onToggle={toggle}
          action={
            <button type="button" className="icon-button" aria-label="Add remote" title="Add remote" onClick={actions.addRemote}>
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
                      { label: `Fetch ${name}`, onSelect: () => actions.fetchRemote(name) },
                      'separator',
                      { label: 'Edit URL…', onSelect: () => actions.editRemote(name) },
                      { label: 'Rename…', onSelect: () => actions.renameRemote(name) },
                      { label: 'Remove…', danger: true, onSelect: () => actions.removeRemote(name) },
                      'separator',
                      { label: 'Copy URL', onSelect: () => copyText(data.remoteUrls[name]?.fetch ?? '') },
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
                        onClick={() => onSelectCommit(branch.sha)}
                        onDoubleClick={() => actions.checkout({ kind: 'remote', name: branch.name, remote: branch.remote })}
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData(REF_MIME, branch.name)}
                        onContextMenu={(event) =>
                          openMenu(event, [
                            { label: `Check out ${branch.name}`, onSelect: () => actions.checkout({ kind: 'remote', name: branch.name, remote: branch.remote }) },
                            'separator',
                            { label: `Merge ${branch.name} into ${current}…`, disabled: busy, onSelect: () => actions.merge(branch.name, branch.name) },
                            { label: `Rebase ${current} onto ${branch.name}…`, disabled: busy, onSelect: () => actions.rebase(branch.name, branch.name) },
                            'separator',
                            { label: 'Create branch here…', onSelect: () => actions.createBranch(branch.sha, branch.name) },
                            { label: 'Create tag here…', onSelect: () => actions.createTag(branch.sha, branch.name) },
                            'separator',
                            ...filterItems(`refs/remotes/${branch.name}`),
                            'separator',
                            { label: 'Copy branch name', onSelect: () => copyText(branch.name) },
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
          title="Tags"
          count={data.tags.length}
          collapsed={Boolean(collapsed['tags'])}
          onToggle={toggle}
          action={head && addButton('Create tag', () => actions.createTag(head, headLabel(data)))}
        >
          {tags.map((tag) => (
            <li
              key={tag.name}
              className="ref-item"
              data-ref={tag.name}
              title={tag.annotated ? `${tag.name} (annotated)` : tag.name}
              onClick={() => onSelectCommit(tag.sha)}
              onContextMenu={(event) =>
                openMenu(event, [
                  { label: `Check out ${tag.name} (detached)`, onSelect: () => actions.checkout({ kind: 'commit', sha: tag.sha }) },
                  { label: 'Create branch here…', onSelect: () => actions.createBranch(tag.sha, tag.name) },
                  'separator',
                  { label: 'Delete tag…', danger: true, onSelect: () => actions.deleteTag(tag.name) },
                  'separator',
                  { label: 'Copy tag name', onSelect: () => copyText(tag.name) },
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
          title="Stashes"
          count={data.stashes.length}
          collapsed={Boolean(collapsed['stashes'])}
          onToggle={toggle}
          action={
            <button type="button" className="icon-button" aria-label="Stash changes" title="Stash changes" onClick={actions.stash} disabled={data.changes.length === 0}>
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
                    { label: 'Apply stash', onSelect: () => actions.applyStash(stash.sha) },
                    { label: 'Pop stash', onSelect: () => actions.popStash(stash.sha) },
                    'separator',
                    { label: 'Delete stash…', danger: true, onSelect: () => actions.dropStash(stash.sha, label) },
                    'separator',
                    { label: 'Copy stash message', onSelect: () => copyText(stash.message) },
                  ])
                }
              >
                <span className="codicon codicon-archive" aria-hidden="true" />
                <span className="ref-name">{stash.message.replace(/^(WIP on|On) [^:]+: /, '')}</span>
              </li>
            );
          })}
        </Section>

        <Section
          id="submodules"
          title="Submodules"
          count={submoduleList.data?.length ?? 0}
          collapsed={Boolean(collapsed['submodules'])}
          onToggle={toggle}
          action={
            <button type="button" className="icon-button" aria-label="Add a submodule" title="Add a submodule" onClick={actions.addSubmodule}>
              <span className="codicon codicon-add" aria-hidden="true" />
            </button>
          }
        >
          {submodules.map((submodule) => {
            const ready = submodule.state !== 'uninitialized';
            const note = { uninitialized: 'not initialized', current: '', moved: 'at another commit', conflict: 'conflict' }[submodule.state];
            return (
              <li
                key={submodule.path}
                className={`ref-item submodule ${submodule.state}`}
                data-submodule={submodule.path}
                title={`${submodule.path} — ${submodule.url}${note ? ` (${note})` : ''}${submodule.dirty ? ', changed inside' : ''}`}
                onDoubleClick={() => (ready ? actions.openSubmodule(submodule.path) : actions.updateSubmodules(submodule.path))}
                onContextMenu={(event) =>
                  openMenu(event, [
                    { label: 'Open in a new tab', disabled: !ready, onSelect: () => actions.openSubmodule(submodule.path) },
                    { label: ready ? 'Update' : 'Initialize and update', onSelect: () => actions.updateSubmodules(submodule.path) },
                    { label: 'Update all submodules', onSelect: () => actions.updateSubmodules(null) },
                    { label: 'Sync URLs from .gitmodules', onSelect: actions.syncSubmodules },
                    'separator',
                    { label: 'Copy path', onSelect: () => copyText(submodule.path) },
                    { label: 'Copy URL', onSelect: () => copyText(submodule.url) },
                    'separator',
                    { label: 'Remove submodule…', danger: true, onSelect: () => actions.removeSubmodule(submodule.path) },
                  ])
                }
              >
                <span className={`codicon ${ready ? 'codicon-file-submodule' : 'codicon-cloud-download'}`} aria-hidden="true" />
                <span className="ref-name">{submodule.path}</span>
                {(note || submodule.dirty) && <span className="submodule-state">{[note, submodule.dirty && 'changed'].filter(Boolean).join(', ')}</span>}
              </li>
            );
          })}
        </Section>

        <Section
          id="gitflow"
          title="Gitflow"
          count={flows.length}
          collapsed={Boolean(collapsed['gitflow'])}
          onToggle={toggle}
          action={
            flowConfig ? (
              <button
                type="button"
                className="icon-button"
                aria-label="Start a feature, release or hotfix"
                title="Start a feature, release or hotfix"
                onClick={(event) =>
                  openMenu(event, [
                    { label: 'Start a feature…', onSelect: () => gitflow.start('feature') },
                    { label: 'Start a release…', onSelect: () => gitflow.start('release') },
                    { label: 'Start a hotfix…', onSelect: () => gitflow.start('hotfix') },
                    'separator',
                    { label: 'Gitflow settings…', onSelect: gitflow.init },
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
                Set up Gitflow…
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
                  { label: `Finish ${kind} ${name}…`, onSelect: () => gitflow.finish(branch.name) },
                  { label: `Check out ${branch.name}`, disabled: branch.current, onSelect: () => actions.checkout({ kind: 'branch', name: branch.name }) },
                  'separator',
                  { label: 'Delete…', danger: true, disabled: branch.current, onSelect: () => actions.deleteBranch(branch.name) },
                ])
              }
            >
              <span className={`codicon ${kind === 'feature' ? 'codicon-sparkle' : kind === 'release' ? 'codicon-rocket' : 'codicon-flame'}`} aria-hidden="true" />
              <span className="ref-name">{name}</span>
              <span className="submodule-state">{kind}</span>
            </li>
          ))}
        </Section>

        <Section
          id="worktrees"
          title="Worktrees"
          count={worktreeList.data?.length ?? 0}
          collapsed={Boolean(collapsed['worktrees'])}
          onToggle={toggle}
          action={
            <button type="button" className="icon-button" aria-label="Add a working tree" title="Add a working tree" onClick={() => actions.addWorktree()}>
              <span className="codicon codicon-add" aria-hidden="true" />
            </button>
          }
        >
          {worktrees.map((tree) => {
            const name = tree.path.split(/[\\/]/).filter(Boolean).pop() ?? tree.path;
            const note = [tree.current && 'this tab', tree.main && 'main', tree.locked !== null && 'locked', tree.prunable && 'missing'].filter(Boolean).join(', ');
            return (
              <li
                key={tree.path}
                className={`ref-item worktree${tree.current ? ' current' : ''}${tree.prunable ? ' prunable' : ''}`}
                data-worktree={tree.path}
                title={`${tree.path}${tree.branch ? ` — ${tree.branch}` : tree.head ? ` — detached at ${tree.head.slice(0, 7)}` : ''}${tree.locked ? ` (locked: ${tree.locked})` : ''}`}
                onDoubleClick={() => !tree.current && !tree.prunable && !tree.bare && actions.openWorktree(tree.path)}
                onContextMenu={(event) =>
                  openMenu(event, [
                    { label: 'Open in a new tab', disabled: tree.current || tree.prunable || tree.bare, onSelect: () => actions.openWorktree(tree.path) },
                    'separator',
                    tree.locked === null
                      ? { label: 'Lock', disabled: tree.main, onSelect: () => actions.lockWorktree(tree.path, true) }
                      : { label: 'Unlock', onSelect: () => actions.lockWorktree(tree.path, false) },
                    { label: 'Prune missing working trees', onSelect: actions.pruneWorktrees },
                    'separator',
                    { label: 'Copy path', onSelect: () => copyText(tree.path) },
                    'separator',
                    { label: 'Remove working tree…', danger: true, disabled: tree.main || tree.current || tree.locked !== null, onSelect: () => actions.removeWorktree(tree.path) },
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
