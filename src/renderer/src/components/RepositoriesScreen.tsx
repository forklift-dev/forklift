import { useEffect, useRef, useState } from 'react';
import { currentLanguage, t } from '../../../shared/i18n';
import type { RecentRepo, RepoGroup, RepoGroupStatus } from '../../../shared/state';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { useAppState } from '../state';
import { GitCliStatus } from './GitCliStatus';
import { NewRepoDialog, type NewRepoKind } from './NewRepoDialog';

const MINUTE = 60_000;
const units: Array<[limit: number, size: number, unit: Intl.RelativeTimeFormatUnit]> = [
  [MINUTE, 1000, 'second'],
  [60 * MINUTE, MINUTE, 'minute'],
  [24 * 60 * MINUTE, 60 * MINUTE, 'hour'],
  [30 * 24 * 60 * MINUTE, 24 * 60 * MINUTE, 'day'],
  [Infinity, 30 * 24 * 60 * MINUTE, 'month'],
];
function ago(time: number, now: number): string {
  const elapsed = Math.max(0, now - time);
  const [, size, unit] = units.find(([limit]) => elapsed < limit)!;
  return new Intl.RelativeTimeFormat(currentLanguage(), { numeric: 'auto' }).format(-Math.round(elapsed / size), unit);
}

const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

interface RepositoriesScreenProps {
  run: RunAction;
  /** Called after a repository was opened (the screen then gives way to its tab). */
  onOpened(): void;
  /** Absent when there is nothing to go back to (no tabs). */
  onClose?(): void;
  /** The Clone or Init dialog, when open (the command palette can open them too). */
  creating: NewRepoKind | null;
  onCreating(kind: NewRepoKind | null): void;
}

function GroupColorPicker({ group, onChange }: { group: RepoGroup; onChange(color: number): void }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  return <div className="repo-group-color-picker" ref={pickerRef} onKeyDown={(event) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    triggerRef.current?.focus();
  }}>
    <button ref={triggerRef} type="button" className="repo-group-color-trigger" aria-label={t('Group color')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="repo-group-color" aria-hidden="true" />
      <span className="codicon codicon-chevron-down" aria-hidden="true" />
    </button>
    {open && <div className="repo-group-color-options" role="dialog" aria-label={t('Group color')}>
      {Array.from({ length: 10 }, (_, color) => <button
        key={color}
        type="button"
        className={`repo-group-color-option lane-${color}`}
        aria-label={t('Color {number}', { number: color + 1 })}
        aria-pressed={group.color === color}
        onClick={() => { onChange(color); setOpen(false); triggerRef.current?.focus(); }}
      ><span aria-hidden="true" /></button>)}
    </div>}
  </div>;
}

/** Opening repositories: by folder, from favorites and recent ones, or found by searching a folder. */
export function RepositoriesScreen({ run, onOpened, onClose, creating, onCreating: setCreating }: RepositoriesScreenProps) {
  const { recent, favorites, groups } = useAppState((s) => s.library);
  const openTabs = useAppState((s) => s.tabs.tabs);
  const groupSync = useAppState((s) => s.app.groupSync);
  const [scan, setScan] = useState<{ folder: string; running: boolean; found: string[]; error?: string } | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupStatus, setGroupStatus] = useState<Record<string, RepoGroupStatus[]>>({});
  const [now] = useState(() => Date.now());
  const rootRef = useRef<HTMLElement>(null);
  // Keyboard focus starts inside, so Escape reaches this screen first.
  useEffect(() => rootRef.current?.focus(), []);
  const syncIsActive = groupSync?.done === false;
  useEffect(() => {
    let alive = true;
    void Promise.all(groups.map(async (group) => [group.id, await invoke('repos:groupStatus', group.id).catch(() => [])] as const)).then((entries) => {
      if (alive && !syncIsActive) setGroupStatus(Object.fromEntries(entries));
    });
    return () => { alive = false; };
  }, [groups, syncIsActive]);

  const open = async (path: string) => {
    if (await run(() => invoke('repo:open', path))) onOpened();
  };

  const pickAndOpen = async () => {
    const path = await invoke('repo:pick', 'open');
    if (path) await open(path);
  };

  const pickAndScan = async () => {
    const folder = await invoke('repo:pick', 'scan');
    if (!folder) return;
    setScan({ folder, running: true, found: [] });
    try {
      const found = await invoke('repos:scan', folder);
      setScan((current) => (current?.folder === folder ? { folder, running: false, found } : current));
    } catch (error) {
      setScan({ folder, running: false, found: [], error: error instanceof Error ? error.message : String(error) });
    }
  };

  const isOpen = (path: string) => openTabs.some((tab) => tab.id === path);
  const byPath = new Map(recent.map((repo) => [repo.path, repo]));
  const favoriteRepos: RecentRepo[] = favorites.map((path) => byPath.get(path) ?? { path, name: nameOf(path), openedAt: 0 });

  const row = (repo: RecentRepo, list: string) => {
    const favorite = favorites.includes(repo.path);
    return (
      <li
        key={`${list}:${repo.path}`}
        className="repo-row"
        data-path={repo.path}
        draggable={list !== 'group'}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/x-forklift-repository', repo.path);
          event.dataTransfer.effectAllowed = 'move';
        }}
      >
        <button
          type="button"
          className={`icon-button star${favorite ? ' on' : ''}`}
          aria-label={favorite ? t('Remove {name} from favorites', { name: repo.name }) : t('Add {name} to favorites', { name: repo.name })}
          aria-pressed={favorite}
          onClick={() => void run(() => invoke('repos:toggleFavorite', repo.path))}
        >
          <span className={`codicon ${favorite ? 'codicon-star-full' : 'codicon-star-empty'}`} aria-hidden="true" />
        </button>
        <button type="button" className="repo-open" onClick={() => void open(repo.path)} title={t('Open {path}', { path: repo.path })}>
          <strong>{repo.name}</strong>
          <span className="repo-path">{repo.path}</span>
        </button>
        <span className="repo-meta">{isOpen(repo.path) ? t('state|open') : repo.openedAt ? ago(repo.openedAt, now) : ''}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Remove {name} from the list', { name: repo.name })}
          title={t('Remove from the list (the folder stays on disk)')}
          onClick={() => void run(() => invoke('repos:forget', repo.path))}
        >
          <span className="codicon codicon-close" aria-hidden="true" />
        </button>
      </li>
    );
  };

  const updateGroup = (group: RepoGroup, patch: Partial<Pick<RepoGroup, 'name' | 'color' | 'repos'>>) => void run(() => invoke('repos:groupUpdate', group.id, patch));
  const openGroup = async (group: RepoGroup) => {
    for (const path of group.repos) await run(() => invoke('repo:open', path));
    onOpened();
  };
  const closeGroup = async (group: RepoGroup) => {
    const members = new Set(group.repos);
    for (const tab of [...openTabs].reverse()) if (members.has(tab.id)) await run(() => invoke('repo:close', tab.id));
  };
  const addToGroup = (group: RepoGroup, path: string) => {
    if (!group.repos.includes(path)) updateGroup(group, { repos: [...group.repos, path] });
  };

  return (
    <section
      className="repositories"
      aria-label={t('Repositories')}
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !onClose) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="repositories-header">
        <h1>{t('Repositories')}</h1>
        <button type="button" className="primary" onClick={() => void pickAndOpen()}>
          {t('Open repository…')}
        </button>
        <button type="button" onClick={() => setCreating('clone')}>
          {t('Clone…')}
        </button>
        <button type="button" onClick={() => setCreating('init')}>
          {t('New…')}
        </button>
        <button type="button" onClick={() => void pickAndScan()} disabled={scan?.running}>
          {t('Search a folder…')}
        </button>
        {onClose && (
          <button type="button" className="close-repositories" onClick={onClose} aria-label={t('Back to the open repository')} title={t('Back (Esc)')}>
            ✕
          </button>
        )}
      </header>
      <div className="repositories-body">
        <p className="hint">
          {t('You can also drop a repository folder anywhere on this window.')} <GitCliStatus />
        </p>
        <section className="repo-section repo-groups" aria-label={t('Repository groups')}>
          <h2>{t('Repository groups')}</h2>
          <form className="repo-group-create" onSubmit={(event) => {
            event.preventDefault();
            const name = groupName.trim();
            if (name) void run(() => invoke('repos:groupCreate', name)).then((ok) => ok && setGroupName(''));
          }}>
            <input aria-label={t('New group name')} value={groupName} maxLength={100} onChange={(event) => setGroupName(event.target.value)} placeholder={t('Group name')} />
            <button type="submit" disabled={!groupName.trim()}>{t('Create group')}</button>
          </form>
          {groups.length === 0 && <p className="empty-note">{t('Create a group, then drag repositories into it.')}</p>}
          {groups.map((group) => {
            const members = group.repos.map((path) => groupStatus[group.id]?.find((item) => item.path === path) ?? { path, name: nameOf(path), branch: null, dirty: false, ahead: 0, behind: 0, error: null });
            const allOpen = group.repos.length > 0 && group.repos.every(isOpen);
            const activity = groupSync?.groupId === group.id ? groupSync : null;
            return (
              <section
                key={group.id}
                className={`repo-group lane-${group.color}`}
                aria-label={group.name}
                onDragOver={(event) => { if (event.dataTransfer.types.includes('text/x-forklift-repository')) event.preventDefault(); }}
                onDrop={(event) => {
                  const path = event.dataTransfer.getData('text/x-forklift-repository');
                  if (path) { event.preventDefault(); addToGroup(group, path); }
                }}
              >
                <header className="repo-group-header">
                  <input aria-label={t('Group name')} defaultValue={group.name} maxLength={100} onBlur={(event) => event.target.value.trim() !== group.name && event.target.value.trim() && updateGroup(group, { name: event.target.value.trim() })} />
                  <GroupColorPicker group={group} onChange={(color) => updateGroup(group, { color })} />
                  <button type="button" onClick={() => void (allOpen ? closeGroup(group) : openGroup(group))} disabled={!group.repos.length}>{allOpen ? t('Close group') : t('Open group')}</button>
                  <button type="button" onClick={() => void run(() => invoke('repos:groupSync', group.id, 'fetch'))} disabled={!group.repos.length || Boolean(groupSync && !groupSync.done)}>{t('Fetch all')}</button>
                  <button type="button" onClick={() => void run(() => invoke('repos:groupSync', group.id, 'pull'))} disabled={!group.repos.length || Boolean(groupSync && !groupSync.done)}>{t('Pull all (fast-forward)')}</button>
                  <button type="button" className="danger-text" onClick={() => {
                    if (window.confirm(t('Remove the group? Repositories on disk will stay untouched.'))) void run(() => invoke('repos:groupRemove', group.id));
                  }} aria-label={t('Remove group')}>×</button>
                </header>
                <ul className="repo-list">
                  {members.map((member) => (
                    <li key={member.path} className="repo-row" data-path={member.path}>
                      <button type="button" className="repo-open" onClick={() => void open(member.path)} title={t('Open {path}', { path: member.path })}>
                        <strong>{member.name}</strong><span className="repo-path">{member.path}</span>
                      </button>
                      <span className="repo-group-status">
                        {member.error ? member.error : <>{member.branch ?? t('Detached')} · {member.dirty ? t('Changes') : t('Clean')}{member.behind > 0 && ` · ${t('{count} behind', { count: member.behind })}`}{member.ahead > 0 && ` · ${t('{count} ahead', { count: member.ahead })}`}</>}
                      </span>
                      <button type="button" className="icon-button" aria-label={t('Remove {name} from group', { name: member.name })} onClick={() => updateGroup(group, { repos: group.repos.filter((path) => path !== member.path) })}>×</button>
                    </li>
                  ))}
                </ul>
                {!members.length && <p className="repo-group-drop">{t('Drop repositories here')}</p>}
                {activity && <div className="repo-group-activity" role="status">
                  <strong>{activity.done ? t('Group update complete') : t('Updating repository {current} of {total}', { current: activity.repos.filter((repo) => ['ok', 'up-to-date', 'skipped', 'failed'].includes(repo.status)).length + 1, total: activity.repos.length })}</strong>
                  {!activity.done && <button type="button" onClick={() => void invoke('repos:groupCancel')}>{t('Cancel')}</button>}
                  {activity.done && <button type="button" onClick={() => void invoke('repos:groupDismiss')}>{t('Dismiss')}</button>}
                  <ul>{activity.repos.map((repo) => <li key={repo.path} data-status={repo.status}><span>{repo.name}</span><span>{repo.message}</span></li>)}</ul>
                </div>}
              </section>
            );
          })}
        </section>
        {scan && (
          <section className="repo-section" aria-label={t('Search results')}>
            <h2>
              {scan.running ? t('Searching {folder}…', { folder: scan.folder }) : t('Found {count} in {folder}', { count: scan.found.length, folder: scan.folder })}
              {scan.running && (
                <button type="button" onClick={() => void invoke('repos:cancelScan')}>
                  {t('Stop')}
                </button>
              )}
            </h2>
            {scan.error && <p className="setting-error">{scan.error}</p>}
            {!scan.running && !scan.error && scan.found.length === 0 && <p className="empty-note">{t('No git repositories in this folder')}</p>}
            <ul className="repo-list">{scan.found.map((path) => row(byPath.get(path) ?? { path, name: nameOf(path), openedAt: 0 }, 'found'))}</ul>
          </section>
        )}
        {favoriteRepos.length > 0 && (
          <section className="repo-section" aria-label={t('Favorites')}>
            <h2>{t('Favorites')}</h2>
            <ul className="repo-list">{favoriteRepos.map((repo) => row(repo, 'favorite'))}</ul>
          </section>
        )}
        <section className="repo-section" aria-label={t('Recent')}>
          <h2>{t('Recent')}</h2>
          {recent.length === 0 ? <p className="empty-note">{t('Repositories you open will appear here')}</p> : <ul className="repo-list">{recent.map((repo) => row(repo, 'recent'))}</ul>}
        </section>
      </div>
      {creating && (
        <NewRepoDialog
          kind={creating}
          onClose={() => setCreating(null)}
          onOpened={() => {
            setCreating(null);
            onOpened();
          }}
        />
      )}
    </section>
  );
}
