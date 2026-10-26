import { useEffect, useRef, useState } from 'react';
import { currentLanguage, t } from '../../../shared/i18n';
import type { RecentRepo } from '../../../shared/state';
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

/** Opening repositories: by folder, from favorites and recent ones, or found by searching a folder. */
export function RepositoriesScreen({ run, onOpened, onClose, creating, onCreating: setCreating }: RepositoriesScreenProps) {
  const { recent, favorites } = useAppState((s) => s.library);
  const openTabs = useAppState((s) => s.tabs.tabs);
  const [scan, setScan] = useState<{ folder: string; running: boolean; found: string[]; error?: string } | null>(null);
  const [now] = useState(() => Date.now());
  const rootRef = useRef<HTMLElement>(null);
  // Keyboard focus starts inside, so Escape reaches this screen first.
  useEffect(() => rootRef.current?.focus(), []);

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
      <li key={`${list}:${repo.path}`} className="repo-row" data-path={repo.path}>
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
