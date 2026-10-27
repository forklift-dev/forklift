import type { MouseEvent } from 'react';
import { t } from '../../../shared/i18n';
import type { RemoteActivity, RepoData } from '../../../shared/state';

interface ToolbarProps {
  repo: RepoData | null;
  busy: boolean;
  remote: RemoteActivity | null;
  undo: { undo: string | null; redo: string | null } | null;
  onUndo(): void;
  onRedo(): void;
  /** Pull with the repository's default (merge or rebase). */
  onPull(): void;
  /** The Pull ▾ menu: fetch, pull with merge, pull with rebase. */
  onPullMenu(event: MouseEvent): void;
  onPush(): void;
  onCreateBranch(): void;
  onStash(): void;
  onPop(): void;
  onOpenTerminal(): void;
  onCancelRemote(): void;
  /** The repository ▾ menu (recent repositories, open, clone, refresh, close). */
  onRepoMenu(event: MouseEvent): void;
  /** The branch ▾ switcher. */
  onSwitchBranch(): void;
  /** Selects the remote branch tracked by the current local branch. */
  onSetUpstream(): void;
  onActions(): void;
  onSearch(): void;
}

// A function, not a table: messages are translated when shown (the language can change while running).
const verb = (kind: RemoteActivity['kind']) =>
  ({ fetch: t('Fetching'), pull: t('Pulling'), push: t('Pushing'), submodules: t('Updating submodules') })[kind];

/** A menu anchored under the element that was clicked, rather than at the pointer. */
const below = (event: MouseEvent): MouseEvent => {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return { clientX: box.left, clientY: box.bottom, preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation() } as unknown as MouseEvent;
};

interface ToolButtonProps {
  label: string;
  icon: string;
  onClick(): void;
  disabled?: boolean;
  title?: string;
  running?: boolean;
}

/** As in GitKraken: the caption above the icon, flat, the whole height of the bar. */
function ToolButton({ label, icon, onClick, disabled, title, running }: ToolButtonProps) {
  return (
    <button type="button" className="tool-button" onClick={onClick} disabled={disabled} title={title ?? label} aria-label={label}>
      <span className="tool-caption">{label}</span>
      {running ? <span className="tool-spinner spinner" aria-hidden="true" /> : <span className={`codicon codicon-${icon}`} aria-hidden="true" />}
    </button>
  );
}

/** Repository ▾ › branch ▾ on the left, the actions in the middle, actions palette and search on the right. */
export function Toolbar(props: ToolbarProps) {
  const { repo, busy, remote, undo } = props;
  const branch = repo?.branch;
  const noRepo = !repo;
  return (
    <header className="toolbar">
      <div className="toolbar-repo">
        <button type="button" className="crumb" onClick={(event) => props.onRepoMenu(below(event))} aria-haspopup="menu" title={repo?.root}>
          <span className="crumb-label">{t('repository')}</span>
          <span className="crumb-value">
            <strong>{repo?.name ?? 'Forklift'}</strong>
            <span className="codicon codicon-chevron-down" aria-hidden="true" />
          </span>
        </button>
        {branch && (
          <>
            <span className="crumb-separator codicon codicon-chevron-right" aria-hidden="true" />
            <button type="button" className="crumb" onClick={props.onSwitchBranch} title={t('Switch branch')}>
              <span className="crumb-label">{t('branch')}</span>
              <span className="crumb-value">
                <span className="branch">
                  {branch.head ?? t('detached at {sha}', { sha: branch.oid?.slice(0, 7) ?? '?' })}
                  {branch.upstream && (branch.ahead > 0 || branch.behind > 0) && (
                    <span className="ahead-behind" title={t('{ahead} ahead, {behind} behind {upstream}', { ahead: branch.ahead, behind: branch.behind, upstream: branch.upstream })}>
                      {branch.ahead > 0 && ` ↑${branch.ahead}`}
                      {branch.behind > 0 && ` ↓${branch.behind}`}
                    </span>
                  )}
                </span>
                <span className="codicon codicon-chevron-down" aria-hidden="true" />
              </span>
            </button>
            {branch.head && (
              <>
                <span className="crumb-separator codicon codicon-chevron-right" aria-hidden="true" />
                <button type="button" className="crumb crumb-upstream" onClick={props.onSetUpstream} title={branch.upstream ? t('Change upstream (now {upstream})…', { upstream: branch.upstream }) : t('Set upstream…')} aria-label={branch.upstream ? t('Change upstream (now {upstream})…', { upstream: branch.upstream }) : t('Set upstream…')}>
                  <span className="crumb-label">{t('remote branch')}</span>
                  <span className="crumb-value">
                    <span className="upstream-value">{branch.upstream ?? t('Select upstream…')}</span>
                    <span className="codicon codicon-chevron-down" aria-hidden="true" />
                  </span>
                </button>
              </>
            )}
          </>
        )}
        {busy && <span className="spinner toolbar-busy" aria-label={t('Loading')} />}
      </div>

      <div className="toolbar-actions">
        <ToolButton label={t('Undo')} icon="discard" onClick={props.onUndo} disabled={busy || noRepo || !undo?.undo} title={undo?.undo ? t('Undo {action} (Ctrl+Z)', { action: undo.undo }) : t('Nothing to undo')} />
        <ToolButton label={t('Redo')} icon="redo" onClick={props.onRedo} disabled={busy || noRepo || !undo?.redo} title={undo?.redo ? t('Redo {action} (Ctrl+Shift+Z)', { action: undo.redo }) : t('Nothing to redo')} />
        <span className="tool-split">
          <ToolButton
            label={t('Pull')}
            icon="repo-pull"
            onClick={props.onPull}
            disabled={noRepo || !branch?.head || Boolean(remote)}
            running={remote?.kind === 'pull' || remote?.kind === 'fetch'}
            title={repo?.pullRebase ? t('Pull (rebase)') : t('Pull (merge)')}
          />
          <button type="button" className="tool-split-arrow" onClick={(event) => props.onPullMenu(below(event))} disabled={noRepo || Boolean(remote)} aria-label={t('More pull options')} title={t('Fetch, pull with merge or rebase')}>
            <span className="codicon codicon-triangle-down" aria-hidden="true" />
          </button>
        </span>
        <ToolButton
          label={t('Push')}
          icon="repo-push"
          onClick={props.onPush}
          disabled={noRepo || !branch?.head || Boolean(remote)}
          running={remote?.kind === 'push'}
          title={t('Push the current branch (a push cannot be undone)')}
        />
        <ToolButton label={t('Branch')} icon="git-branch-create" onClick={props.onCreateBranch} disabled={busy || noRepo || !branch?.oid} title={t('Create a branch at HEAD (Ctrl+B)')} />
        <ToolButton label={t('Stash')} icon="git-stash" onClick={props.onStash} disabled={busy || noRepo || repo.changes.length === 0} title={t('Stash all changes, untracked files included')} />
        <ToolButton label={t('Pop')} icon="git-stash-pop" onClick={props.onPop} disabled={busy || noRepo || repo.stashes.length === 0} title={repo?.stashes[0] ? t('Pop {stash}', { stash: repo.stashes[0].message }) : t('No stashes')} />
        <span className="tool-separator" aria-hidden="true" />
        <ToolButton label={t('Terminal')} icon="terminal" onClick={props.onOpenTerminal} disabled={noRepo} title={t('Show or hide the terminal (Ctrl+`)')} />
      </div>

      <div className="toolbar-end">
        {remote && (
          <span className="remote-activity" role="status">
            {verb(remote.kind)}
            {remote.phase && ` · ${remote.phase}`}
            {remote.percent !== null && ` ${remote.percent}%`}
            <button type="button" className="link-button" onClick={props.onCancelRemote}>
              {t('Cancel')}
            </button>
          </span>
        )}
        <ToolButton label={t('Actions')} icon="zap" onClick={props.onActions} title={t('All commands (Ctrl+Shift+P)')} />
        <ToolButton label={t('Search')} icon="search" onClick={props.onSearch} disabled={noRepo} title={t('Go to a file, branch, tag or commit (Ctrl+P)')} />
      </div>
      {remote && (
        <div className="toolbar-progress" aria-hidden="true">
          <div className={`toolbar-progress-bar${remote.percent === null ? ' indeterminate' : ''}`} style={remote.percent === null ? undefined : { width: `${remote.percent}%` }} />
        </div>
      )}
    </header>
  );
}
