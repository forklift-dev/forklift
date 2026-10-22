import { isAbsolute } from 'node:path';
import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from 'electron';
import type { DiffTarget } from '../../shared/diff';
import type { GitToolKind, ToolKind } from '../../shared/settings';
import type { LineAction, LineActionRequest, LineChange } from '../../shared/staging';
import type { DiffTools } from '../external/diffTools';
import type { ExternalTools } from '../external/tools';
import type { GitService } from '../git/service';
import type { StagingService } from '../git/staging';
import type { SettingsService } from '../settings/service';
import type { ToolActions } from '../settings/toolActions';
import { normalizeRepoRelative, resolveInsideRepo } from '../repoPaths';
import { noticesDismissed, type AppStore } from '../store';
import type { RepoScanner } from '../repos/scan';
import { openRepository } from '../repos/open';
import { favoriteToggled, repoForgotten } from '../store/librarySlice';
import { loadRepo, tabActivated, tabClosed, tabMoved } from '../store/reposSlice';
import { settingsProblemsDismissed } from '../store/settingsSlice';
import type { CommandHandlers } from './registry';

export interface HandlerDeps {
  store: AppStore;
  git: GitService;
  tools: ExternalTools;
  diffTools: DiffTools;
  staging: StagingService;
  settings: SettingsService;
  toolActions: ToolActions;
  scanner: RepoScanner;
}

// Arguments arrive from the renderer and are validated at runtime despite the typed contract.
function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
}

function assertSha(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(value)) throw new TypeError('sha must be a full commit hash');
}

const MAX_PATHS = 10_000;

function parsePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PATHS) throw new TypeError('paths must be a non-empty array');
  return value.map((path) => {
    assertString(path, 'path');
    return normalizeRepoRelative(path);
  });
}

const isLineNumber = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;

function parseLineActionRequest(value: unknown): LineActionRequest {
  if (typeof value !== 'object' || value === null) throw new TypeError('request must be an object');
  const raw = value as Record<string, unknown>;
  const action = raw['action'];
  if (action !== 'stage' && action !== 'unstage' && action !== 'discard') throw new TypeError('unknown line action');
  assertString(raw['path'], 'path');
  const hashes = [raw['originalHash'], raw['modifiedHash']];
  if (!hashes.every((hash) => typeof hash === 'string' || hash === null)) throw new TypeError('hashes must be strings');
  const changes = raw['changes'];
  if (!Array.isArray(changes)) throw new TypeError('changes must be an array');
  const keys = ['originalStartLineNumber', 'originalEndLineNumber', 'modifiedStartLineNumber', 'modifiedEndLineNumber'] as const;
  for (const change of changes) {
    if (typeof change !== 'object' || change === null || !keys.every((key) => isLineNumber((change as Record<string, unknown>)[key]))) {
      throw new TypeError('malformed line change');
    }
  }
  const lines = (list: unknown) => {
    if (!Array.isArray(list) || !list.every((line) => isLineNumber(line) && line > 0)) throw new TypeError('selected lines must be positive integers');
    return list as number[];
  };
  return {
    action: action as LineAction,
    path: normalizeRepoRelative(raw['path']),
    originalHash: hashes[0] as string,
    modifiedHash: hashes[1] as string,
    changes: (changes as LineChange[]).map((change) => Object.fromEntries(keys.map((key) => [key, change[key]])) as unknown as LineChange),
    selectedOriginal: lines(raw['selectedOriginal']),
    selectedModified: lines(raw['selectedModified']),
  };
}

function parseDiffTarget(value: unknown): DiffTarget {
  if (typeof value !== 'object' || value === null) throw new TypeError('target must be an object');
  const raw = value as Record<string, unknown>;
  assertString(raw['path'], 'target.path');
  const path = normalizeRepoRelative(raw['path']);
  const oldPath = raw['oldPath'] === undefined ? undefined : normalizeRepoRelative(String(raw['oldPath']));
  const paths = { path, ...(oldPath !== undefined && { oldPath }) };
  if (raw['kind'] === 'commit') {
    assertSha(raw['sha']);
    return { kind: 'commit', sha: raw['sha'], ...paths };
  }
  if (raw['kind'] === 'worktree') {
    if (typeof raw['staged'] !== 'boolean') throw new TypeError('target.staged must be a boolean');
    return { kind: 'worktree', staged: raw['staged'], ...paths };
  }
  throw new TypeError('target.kind must be "commit" or "worktree"');
}

const TOOL_KINDS: readonly ToolKind[] = ['editor', 'terminal', 'diff', 'merge'];

function parseToolKind(value: unknown): ToolKind {
  if (!TOOL_KINDS.includes(value as ToolKind)) throw new TypeError('kind must be editor, terminal, diff or merge');
  return value as ToolKind;
}

function parseGitToolKind(value: unknown): GitToolKind {
  if (value !== 'diff' && value !== 'merge') throw new TypeError('kind must be diff or merge');
  return value;
}

function assertAbsolutePath(value: unknown, name: string): asserts value is string {
  assertString(value, name);
  if (value.length > 4096 || !isAbsolute(value)) throw new TypeError(`${name} must be an absolute path`);
}

async function showOpenDialog(sender: WebContents, options: OpenDialogOptions) {
  const window = BrowserWindow.fromWebContents(sender);
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export function createCommandHandlers({ store, git, tools, diffTools, staging, settings, toolActions, scanner }: HandlerDeps): CommandHandlers {
  const effective = (root: string) => settings.effective(root);
  const isOpen = (id: string) => Boolean(store.getState().repos.byId[id]);

  /** The tab named by the window; operations always say which repository they mean. */
  const tab = (id: unknown): string => {
    assertString(id, 'repo');
    if (!isOpen(id)) throw new Error('This repository is not open');
    return id;
  };
  const optionalTab = (id: unknown): string | null => (id === null ? null : tab(id));
  const repoData = (id: string) => store.getState().repos.byId[id]?.data ?? null;

  /** Runs an index/working-tree operation, then re-reads the repository whether or not it succeeded. */
  const thenRefresh = async <T>(root: string, operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } finally {
      if (isOpen(root)) await store.dispatch(loadRepo(root));
    }
  };

  return {
    async 'index:stage'(_ctx, repo, paths) {
      const root = tab(repo);
      await thenRefresh(root, () => staging.stageFiles(root, parsePaths(paths)));
    },

    async 'index:unstage'(_ctx, repo, paths) {
      const root = tab(repo);
      const unborn = repoData(root)?.branch.oid == null;
      await thenRefresh(root, () => staging.unstageFiles(root, parsePaths(paths), unborn));
    },

    async 'index:discard'(_ctx, repo, paths) {
      const root = tab(repo);
      const changes = new Map(repoData(root)?.changes.map((change) => [change.path, change]));
      const tracked: string[] = [];
      const untracked: string[] = [];
      for (const path of parsePaths(paths)) {
        const kind = changes.get(path)?.kind;
        if (kind === undefined) throw new Error(`${path} has no changes to discard`);
        if (kind === 'conflicted') throw new Error(`${path} is in conflict; resolve it instead of discarding`);
        (kind === 'untracked' ? untracked : tracked).push(path);
      }
      await thenRefresh(root, () => staging.discardFiles(root, tracked, untracked));
    },

    async 'index:applyLines'(_ctx, repo, request) {
      const root = tab(repo);
      await thenRefresh(root, () => staging.applyLines(root, parseLineActionRequest(request)));
    },

    async 'commit:create'(_ctx, repo, message, amend) {
      const root = tab(repo);
      if (typeof message !== 'string' || message.trim() === '') throw new TypeError('Commit message is empty');
      if (typeof amend !== 'boolean') throw new TypeError('amend must be a boolean');
      return thenRefresh(root, () => staging.commit(root, message, amend));
    },

    async 'commit:details'(_ctx, repo, sha) {
      const root = tab(repo);
      assertSha(sha);
      return git.commitDetails(root, sha);
    },

    async 'diff:file'(_ctx, repo, target) {
      return git.fileDiff(tab(repo), parseDiffTarget(target));
    },

    async 'repo:pick'({ sender }, purpose) {
      const title = purpose === 'scan' ? 'Choose a folder to search for repositories' : 'Open repository';
      return showOpenDialog(sender, { title, properties: ['openDirectory'] });
    },

    async 'repo:open'(_ctx, path) {
      assertAbsolutePath(path, 'path');
      return openRepository(store, git, path);
    },

    async 'repo:activate'(_ctx, repo) {
      const root = tab(repo);
      store.dispatch(tabActivated(root));
      // Restored tabs are read the first time they are shown.
      const state = store.getState().repos.byId[root]!;
      if (!state.data && !state.loading && !state.error) await store.dispatch(loadRepo(root));
    },

    async 'repo:refresh'(_ctx, repo) {
      await store.dispatch(loadRepo(tab(repo))).unwrap();
    },

    async 'repo:close'(_ctx, repo) {
      store.dispatch(tabClosed(tab(repo)));
      const active = store.getState().repos.view.activeId;
      const next = active ? store.getState().repos.byId[active] : null;
      if (active && next && !next.data && !next.loading && !next.error) await store.dispatch(loadRepo(active));
    },

    async 'repo:move'(_ctx, repo, index) {
      if (!Number.isInteger(index) || index < 0) throw new TypeError('index must be a non-negative integer');
      store.dispatch(tabMoved({ id: tab(repo), index }));
    },

    async 'repo:openTerminal'(_ctx, repo) {
      const root = tab(repo);
      await tools.openTerminal(root, effective(root)['tools.terminal']);
    },

    async 'repos:scan'(_ctx, folder) {
      assertAbsolutePath(folder, 'folder');
      return scanner.scan(folder);
    },

    async 'repos:cancelScan'() {
      scanner.cancel();
    },

    async 'repos:toggleFavorite'(_ctx, path) {
      assertAbsolutePath(path, 'path');
      store.dispatch(favoriteToggled(path));
    },

    async 'repos:forget'(_ctx, path) {
      assertAbsolutePath(path, 'path');
      store.dispatch(repoForgotten(path));
    },

    async 'file:openInEditor'(_ctx, repo, path, line) {
      const root = tab(repo);
      assertString(path, 'path');
      if (line !== undefined && (!Number.isInteger(line) || line < 1)) throw new TypeError('line must be a positive integer');
      await tools.openInEditor(await resolveInsideRepo(root, path), line, root, effective(root)['tools.editor']);
    },

    async 'file:externalDiff'(_ctx, repo, path, staged) {
      const root = tab(repo);
      assertString(path, 'path');
      if (typeof staged !== 'boolean') throw new TypeError('staged must be a boolean');
      await diffTools.diff(root, normalizeRepoRelative(path), staged, effective(root)['tools.diff']);
    },

    async 'file:externalMerge'(_ctx, repo, path) {
      const root = tab(repo);
      assertString(path, 'path');
      try {
        await diffTools.merge(root, normalizeRepoRelative(path), effective(root)['tools.merge']);
      } finally {
        // Whether or not git accepted the resolution, the working tree and index changed.
        if (isOpen(root)) await store.dispatch(loadRepo(root));
      }
    },

    async 'app:dismissNotices'() {
      store.dispatch(noticesDismissed());
    },

    async 'settings:update'(_ctx, patch) {
      await settings.update(patch);
    },

    async 'settings:dismissProblems'() {
      store.dispatch(settingsProblemsDismissed());
    },

    async 'settings:browseExecutable'({ sender }) {
      return showOpenDialog(sender, { title: 'Choose program', properties: ['openFile', 'dontAddToRecent'] });
    },

    async 'tools:detect'(_ctx, repo) {
      return toolActions.detect(optionalTab(repo));
    },

    async 'tools:test'(_ctx, kind, repo) {
      return toolActions.test(parseToolKind(kind), optionalTab(repo));
    },

    async 'tools:writeGitConfig'(_ctx, kind, repo) {
      await toolActions.writeGitConfig(parseGitToolKind(kind), optionalTab(repo));
    },

    async 'git:identity'(_ctx, repo) {
      return toolActions.identity(optionalTab(repo));
    },

    async 'git:setIdentity'(_ctx, repo, identity) {
      await toolActions.setIdentity(optionalTab(repo), identity);
    },
  };
}
