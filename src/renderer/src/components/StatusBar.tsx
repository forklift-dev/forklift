import { useCallback, useEffect, useRef, useState } from 'react';
import { currentLanguage, formatDate, t, translate } from '../../../shared/i18n';
import type { AppStatus, RemoteActivity, RepoData, RepoOperation } from '../../../shared/state';
import { invoke } from '../api';
import { GRAPH_STYLES } from '../graphStyles';
import { useAppState } from '../state';
import { elapsedTime, formatMemory, relativeTime } from '../statusFormat';
import { AboutDialog } from './AboutDialog';
import { GraphStylePreview } from './preferences/GraphStylePicker';

type Menu = 'graph' | 'system' | null;

interface StatusBarProps {
  repo: RepoData | null;
  remote: RemoteActivity | null;
  onBranch(): void;
  onChanges(): void;
  onFetch(): void;
  onLog(): void;
  onPreferences(section: 'ui' | 'git'): void;
  onGraphStyle(style: string): void;
  onWriteCommitGraph(): void;
}

const remoteOperation = (activity: RemoteActivity) =>
  ({ fetch: t('Fetching'), pull: t('Pulling'), push: t('Pushing'), submodules: t('Updating submodules') })[activity.kind];

const repoOperation = (operation: RepoOperation) => {
  const name = translate(({ merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert' })[operation.kind]);
  return operation.step && operation.total ? `${name} ${operation.step}/${operation.total}` : name;
};

function Icon({ name }: { name: string }) {
  return <span className={`codicon codicon-${name}`} aria-hidden="true" />;
}

/** Always-visible, compact repository and application status at the bottom of the window. */
export function StatusBar(props: StatusBarProps) {
  const version = useAppState((state) => state.app.version);
  const git = useAppState((state) => state.app.gitCli);
  const styleId = useAppState((state) => state.settings.values['ui.graphStyle']);
  const zoom = useAppState((state) => state.settings.values['ui.zoom']);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [about, setAbout] = useState(false);
  const closeAbout = useCallback(() => setAbout(false), []);
  const barRef = useRef<HTMLElement>(null);
  const root = props.repo?.root ?? null;

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await invoke('app:status', root);
        if (live) setStatus(next);
      } catch {
        // A closing window or repository can invalidate one poll; the next one retries.
      } finally {
        if (live) timer = setTimeout(() => void poll(), 3_000);
      }
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [root]);

  useEffect(() => {
    if (!menu) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !barRef.current?.contains(event.target)) setMenu(null);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('keydown', closeEscape, true);
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true);
      window.removeEventListener('keydown', closeEscape, true);
    };
  }, [menu]);

  const operation = props.remote ? remoteOperation(props.remote) : props.repo?.operation ? repoOperation(props.repo.operation) : null;
  const branch = props.repo?.branch;
  const branchText = branch ? branch.head ?? (branch.oid ? t('Detached at {sha}', { sha: branch.oid.slice(0, 7) }) : t('No commits')) : null;
  const style = GRAPH_STYLES.find((item) => item.id === styleId) ?? GRAPH_STYLES[0]!;
  const fetchText = status?.lastFetch ? relativeTime(status.lastFetch) : t('Never');
  const historyText = status?.historySize === null || status?.historySize === undefined ? '…' : new Intl.NumberFormat(currentLanguage()).format(status.historySize);
  const historyState = props.repo?.commitGraph ? t('Commit graph is present') : t('Commit graph is missing');

  const cancel = (id: number) => {
    void invoke('process:cancel', id).then(
      () => setStatus((current) => current && ({ ...current, running: current.running.filter((item) => item.id !== id) })),
      () => {},
    );
  };

  return (
    <footer ref={barRef} className="status-bar" aria-label={t('Status bar')}>
      <div className="status-menu-anchor">
        <button type="button" className="status-item" aria-label={t('Choose graph style')} aria-haspopup="dialog" aria-expanded={menu === 'graph'} title={t('Choose graph style')} onClick={() => setMenu(menu === 'graph' ? null : 'graph')}>
          <Icon name="type-hierarchy-sub" />
          <span>{translate(style.name)}</span>
        </button>
        {menu === 'graph' && (
          <div className="status-popover status-graph-menu" role="dialog" aria-label={t('Choose graph style')}>
            <div role="radiogroup" aria-label={t('Commit graph')}>
              {GRAPH_STYLES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={item.id === styleId}
                  className={`status-graph-option${item.id === styleId ? ' selected' : ''}`}
                  data-status-graph-style={item.id}
                  onClick={() => {
                    props.onGraphStyle(item.id);
                    setMenu(null);
                  }}
                >
                  <GraphStylePreview style={item} />
                  <span>{translate(item.name)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {branchText && (
        <button type="button" className="status-item" title={t('Switch branch')} onClick={props.onBranch}>
          <Icon name="git-branch" />
          <span className="status-ellipsis">{branchText}</span>
          {(branch!.ahead > 0 || branch!.behind > 0) && <span className="status-muted">{branch!.ahead > 0 && `↑${branch!.ahead}`}{branch!.behind > 0 && ` ↓${branch!.behind}`}</span>}
        </button>
      )}
      {props.repo && (
        <button type="button" className="status-item" title={t('Write the commit message')} onClick={props.onChanges}>
          <Icon name="diff" />
          <span>{t('Changes: {count}', { count: props.repo.changes.length })}</span>
        </button>
      )}
      {props.repo && (
        <button type="button" className="status-item status-secondary" disabled={Boolean(props.remote)} aria-label={t('Last fetch: {when}', { when: status?.lastFetch ? formatDate(status.lastFetch) : t('Never') })} title={status?.lastFetch ? formatDate(status.lastFetch) : t('Fetch now')} onClick={props.onFetch}>
          <Icon name="repo-fetch" />
          <span>{t('Fetch: {when}', { when: fetchText })}</span>
        </button>
      )}
      {operation && (
        <button type="button" className="status-item status-operation" title={t('Open operation log')} onClick={props.onLog}>
          <span className="status-pulse" aria-hidden="true" />
          <span>{operation}{props.remote?.percent !== null && props.remote?.percent !== undefined ? ` ${props.remote.percent}%` : ''}</span>
        </button>
      )}

      <span className="status-spacer" />
      <button type="button" className="status-item status-secondary" aria-label={`${git?.version ? `git ${git.version}` : t('git unavailable')}. ${t('Open Git preferences')}`} title={t('Open Git preferences')} onClick={() => props.onPreferences('git')}>
        <Icon name="terminal" />
        <span>{git?.version ? `git ${git.version}` : t('git unavailable')}</span>
      </button>
      {props.repo && (
        <button type="button" className={`status-item status-secondary${props.repo.commitGraph ? '' : ' warning'}`} aria-label={`${t('History: {count}', { count: historyText })}. ${historyState}`} title={props.repo.commitGraph ? t('Rebuild commit graph') : t('Build commit graph')} onClick={props.onWriteCommitGraph}>
          <Icon name="list-tree" />
          <span>{t('History: {count}', { count: historyText })}</span>
          <span aria-label={historyState}>{props.repo.commitGraph ? '✓' : '!'}</span>
        </button>
      )}
      <div className="status-menu-anchor system">
        <button type="button" className="status-item" aria-label={t('System information')} aria-haspopup="dialog" aria-expanded={menu === 'system'} title={t('System information')} onClick={() => setMenu(menu === 'system' ? null : 'system')}>
          <Icon name="server-process" />
          <span>{status ? formatMemory(status.memory) : '…'}</span>
          {status && status.running.length > 0 && <span className="status-count" aria-label={t('Running git processes: {count}', { count: status.running.length })}>{status.running.length}</span>}
        </button>
        {menu === 'system' && (
          <section className="status-popover status-system-menu" role="dialog" aria-label={t('System information')}>
            <h2>{t('System information')}</h2>
            <dl>
              <div><dt>{t('Application memory')}</dt><dd>{status ? formatMemory(status.memory) : '…'}</dd></div>
              <div><dt>{t('Forklift version')}</dt><dd>{version}</dd></div>
            </dl>
            <h3>{t('Running git processes')}</h3>
            {status?.running.length ? (
              <ul>
                {status.running.map((process) => (
                  <li key={process.id}>
                    <span><code title={process.title}>{process.title}</code><small>{t('Running for {duration}', { duration: elapsedTime(process.startedAt) })}</small></span>
                    <button type="button" className="danger" aria-label={t('Stop {command}', { command: process.title })} onClick={() => cancel(process.id)}>{t('Stop')}</button>
                  </li>
                ))}
              </ul>
            ) : <p>{t('No git processes are running')}</p>}
          </section>
        )}
      </div>
      <button type="button" className="status-item status-secondary" aria-label={t('Interface scale: {zoom}%', { zoom })} title={t('Open UI preferences')} onClick={() => props.onPreferences('ui')}>
        <Icon name="zoom-in" />
        <span>{zoom}%</span>
      </button>
      <button type="button" className="status-item status-community" title={t('About Forklift')} onClick={() => { setMenu(null); setAbout(true); }}>
        <span>{t('Community')}</span>
        <span className="status-version">v{version}</span>
      </button>
      {about && <AboutDialog version={version} onClose={closeAbout} />}
    </footer>
  );
}
