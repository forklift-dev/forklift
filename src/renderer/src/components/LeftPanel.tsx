import { useState, type MouseEvent, type ReactNode } from 'react';
import type { RepoData } from '../../../shared/state';
import { copyText, type MenuItem } from './ContextMenu';
import { headLabel, type RefActions } from './useRefActions';

interface LeftPanelProps {
  data: RepoData;
  actions: RefActions;
  openMenu(event: MouseEvent, items: MenuItem[]): void;
  /** Shows a commit in the graph. */
  onSelectCommit(sha: string): void;
}

type SectionId = 'local' | 'remote' | 'tags';

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
export function LeftPanel({ data, actions, openMenu, onSelectCommit }: LeftPanelProps) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  const match = (name: string) => name.toLowerCase().includes(filter.trim().toLowerCase());
  const head = data.branch.oid;

  const local = data.branches.filter((branch) => match(branch.name));
  const remote = data.remoteBranches.filter((branch) => match(branch.name));
  const tags = data.tags.filter((tag) => match(tag.name));
  const remotes = data.remotes.length ? data.remotes : [...new Set(data.remoteBranches.map((branch) => branch.remote))];

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
              className={`ref-item${branch.current ? ' current' : ''}`}
              data-ref={branch.name}
              title={branch.upstream ? `${branch.name} → ${branch.upstream}` : branch.name}
              onClick={() => onSelectCommit(branch.sha)}
              onDoubleClick={() => !branch.current && actions.checkout({ kind: 'branch', name: branch.name })}
              onContextMenu={(event) =>
                openMenu(event, [
                  { label: `Check out ${branch.name}`, disabled: branch.current, onSelect: () => actions.checkout({ kind: 'branch', name: branch.name }) },
                  'separator',
                  { label: 'Create branch here…', onSelect: () => actions.createBranch(branch.sha, branch.name) },
                  { label: 'Create tag here…', onSelect: () => actions.createTag(branch.sha, branch.name) },
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

        <Section id="remote" title="Remote" count={data.remoteBranches.length} collapsed={Boolean(collapsed['remote'])} onToggle={toggle}>
          {remotes.map((name) => {
            const branches = remote.filter((branch) => branch.remote === name);
            const key = `remote:${name}`;
            return (
              <li key={key} className="ref-group">
                <button type="button" className="ref-group-toggle" aria-expanded={!collapsed[key]} onClick={() => toggle(key)}>
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
                        onContextMenu={(event) =>
                          openMenu(event, [
                            { label: `Check out ${branch.name}`, onSelect: () => actions.checkout({ kind: 'remote', name: branch.name, remote: branch.remote }) },
                            'separator',
                            { label: 'Create branch here…', onSelect: () => actions.createBranch(branch.sha, branch.name) },
                            { label: 'Create tag here…', onSelect: () => actions.createTag(branch.sha, branch.name) },
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
      </div>
    </aside>
  );
}
