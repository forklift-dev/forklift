import { useEffect, useRef, useState } from 'react';
import type { RecentRepo } from '../../../shared/state';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { useAppState } from '../state';
import { GitCliStatus } from './GitCliStatus';

const MINUTE = 60_000;
const units: Array<[limit: number, size: number, unit: Intl.RelativeTimeFormatUnit]> = [
  [MINUTE, 1000, 'second'],
  [60 * MINUTE, MINUTE, 'minute'],
  [24 * 60 * MINUTE, 60 * MINUTE, 'hour'],
  [30 * 24 * 60 * MINUTE, 24 * 60 * MINUTE, 'day'],
  [Infinity, 30 * 24 * 60 * MINUTE, 'month'],
];
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function ago(time: number, now: number): string {
  const elapsed = Math.max(0, now - time);
  const [, size, unit] = units.find(([limit]) => elapsed < limit)!;
  return relative.format(-Math.round(elapsed / size), unit);
}

const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

interface RepositoriesScreenProps {
  run: RunAction;
  /** Called after a repository was opened (the screen then gives way to its tab). */
  onOpened(): void;
  /** Absent when there is nothing to go back to (no tabs). */
  onClose?(): void;
}

/** Opening repositories: by folder, from favorites and recent ones, or found by searching a folder. */
export function RepositoriesScreen({ run, onOpened, onClose }: RepositoriesScreenProps) {
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
          aria-label={favorite ? `Remove ${repo.name} from favorites` : `Add ${repo.name} to favorites`}
          aria-pressed={favorite}
          onClick={() => void run(() => invoke('repos:toggleFavorite', repo.path))}
        >
          <span className={`codicon ${favorite ? 'codicon-star-full' : 'codicon-star-empty'}`} aria-hidden="true" />
        </button>
        <button type="button" className="repo-open" onClick={() => void open(repo.path)} title={`Open ${repo.path}`}>
          <strong>{repo.name}</strong>
          <span className="repo-path">{repo.path}</span>
        </button>
        <span className="repo-meta">{isOpen(repo.path) ? 'open' : repo.openedAt ? ago(repo.openedAt, now) : ''}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${repo.name} from the list`}
          title="Remove from the list (the folder stays on disk)"
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
      aria-label="Repositories"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !onClose) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="repositories-header">
        <h1>Repositories</h1>
        <button type="button" className="primary" onClick={() => void pickAndOpen()}>
          Open repository…
        </button>
        <button type="button" onClick={() => void pickAndScan()} disabled={scan?.running}>
          Search a folder…
        </button>
        {onClose && (
          <button type="button" className="close-repositories" onClick={onClose} aria-label="Back to the open repository" title="Back (Esc)">
            ✕
          </button>
        )}
      </header>
      <div className="repositories-body">
        <p className="hint">
          You can also drop a repository folder anywhere on this window. <GitCliStatus />
        </p>
        {scan && (
          <section className="repo-section" aria-label="Search results">
            <h2>
              {scan.running ? `Searching ${scan.folder}…` : `Found ${scan.found.length} in ${scan.folder}`}
              {scan.running && (
                <button type="button" onClick={() => void invoke('repos:cancelScan')}>
                  Stop
                </button>
              )}
            </h2>
            {scan.error && <p className="setting-error">{scan.error}</p>}
            {!scan.running && !scan.error && scan.found.length === 0 && <p className="empty-note">No git repositories in this folder</p>}
            <ul className="repo-list">{scan.found.map((path) => row(byPath.get(path) ?? { path, name: nameOf(path), openedAt: 0 }, 'found'))}</ul>
          </section>
        )}
        {favoriteRepos.length > 0 && (
          <section className="repo-section" aria-label="Favorites">
            <h2>Favorites</h2>
            <ul className="repo-list">{favoriteRepos.map((repo) => row(repo, 'favorite'))}</ul>
          </section>
        )}
        <section className="repo-section" aria-label="Recent">
          <h2>Recent</h2>
          {recent.length === 0 ? <p className="empty-note">Repositories you open will appear here</p> : <ul className="repo-list">{recent.map((repo) => row(repo, 'recent'))}</ul>}
        </section>
      </div>
    </section>
  );
}
