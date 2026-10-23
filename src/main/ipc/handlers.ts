import { isAbsolute } from 'node:path';
import { BrowserWindow, dialog, type OpenDialogOptions, type WebContents } from 'electron';
import type { CheckoutTarget } from '../../shared/branches';
import type { DiffTarget } from '../../shared/diff';
import type { GitToolKind, ToolKind } from '../../shared/settings';
import type { LineAction, LineActionRequest, LineChange } from '../../shared/staging';
import type { BranchService, SwitchResult } from '../git/branches';
import type { ApplyOutcome, StashService } from '../git/stash';
import type { ConflictService } from '../git/conflicts';
import type { CommitOps } from '../git/commitOps';
import type { RemoteProgress, RemoteService } from '../git/remote';
import type { DiffTools } from '../external/diffTools';
import type { ExternalTools } from '../external/tools';
import type { GitService } from '../git/service';
import type { StagingService } from '../git/staging';
import { MAX_PAGE, type HistoryService } from '../history/service';
import type { SettingsService } from '../settings/service';
import type { ToolActions } from '../settings/toolActions';
import { normalizeRepoRelative, resolveInsideRepo } from '../repoPaths';
import { noticeAdded, noticesDismissed, type AppStore } from '../store';
import type { RepoScanner } from '../repos/scan';
import { openRepository } from '../repos/open';
import { favoriteToggled, repoForgotten } from '../store/librarySlice';
import { loadRepo, remoteActivity, tabActivated, tabClosed, tabMoved } from '../store/reposSlice';
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
  history: HistoryService;
  branches: BranchService;
  stashes: StashService;
  conflicts: ConflictService;
  commitOps: CommitOps;
  remotes: RemoteService;
  /** Hands a credential answer to the waiting git process. */
  answerPrompt(id: number, answer: string | null): void;
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

const MAX_NAME = 255;

function parseName(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_NAME) throw new TypeError(`${what} must be 1 to ${MAX_NAME} characters`);
  return value;
}

function parseCheckoutTarget(value: unknown): CheckoutTarget {
  if (typeof value !== 'object' || value === null) throw new TypeError('target must be an object');
  const raw = value as Record<string, unknown>;
  if (raw['kind'] === 'branch') return { kind: 'branch', name: parseName(raw['name'], 'branch') };
  if (raw['kind'] === 'remote') return { kind: 'remote', name: parseName(raw['name'], 'branch'), remote: parseName(raw['remote'], 'remote') };
  if (raw['kind'] === 'commit') {
    assertSha(raw['sha']);
    return { kind: 'commit', sha: raw['sha'] };
  }
  throw new TypeError('target.kind must be branch, remote or commit');
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

export function createCommandHandlers({ store, git, tools, diffTools, staging, settings, toolActions, scanner, history, branches, stashes, conflicts, commitOps, remotes, answerPrompt }: HandlerDeps): CommandHandlers {
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

  /** Switch results that need the user's attention (a conflict, a kept stash) become a notice. */
  const report = (result: SwitchResult) => {
    if (result.message) store.dispatch(noticeAdded(result.message));
  };

  // One network operation per tab: its cancel handle, and progress updates at most every 100 ms.
  const running = new Map<string, AbortController>();
  const network = async <T>(root: string, kind: 'fetch' | 'pull' | 'push', work: (run: { signal: AbortSignal; onProgress(p: RemoteProgress): void }) => Promise<T>): Promise<T> => {
    if (running.has(root)) throw new Error('A fetch, pull or push is already running in this repository');
    const controller = new AbortController();
    running.set(root, controller);
    let last = 0;
    store.dispatch(remoteActivity({ id: root, activity: { kind, phase: null, percent: null } }));
    try {
      return await work({
        signal: controller.signal,
        onProgress: ({ phase, percent }) => {
          const now = Date.now();
          if (now - last < 100 && percent !== 100) return;
          last = now;
          store.dispatch(remoteActivity({ id: root, activity: { kind, phase, percent } }));
        },
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`The ${kind} was cancelled`, { cause: error });
      throw error;
    } finally {
      running.delete(root);
      store.dispatch(remoteActivity({ id: root, activity: null }));
    }
  };

  const stashName = (root: string, sha: string) => {
    const stash = repoData(root)?.stashes.find((s) => s.sha === sha);
    return stash ? `stash@{${stash.index}} (${stash.message})` : 'the stash';
  };
  const reportApply = (what: string, popped: boolean, { outcome, detail }: ApplyOutcome) => {
    if (outcome === 'applied-unstaged') store.dispatch(noticeAdded(`Applied ${what}, but what was staged in it is now unstaged.`));
    else if (outcome === 'conflicts') store.dispatch(noticeAdded(`Applied ${what} with conflicts in ${detail}; resolve them.${popped ? ' The stash is kept.' : ''}`));
    else if (outcome === 'failed') store.dispatch(noticeAdded(`Could not apply ${what}: ${detail}. The stash is unchanged.`));
  };

  return {
    async 'commit:cherryPick'(_ctx, repo, sha) {
      const root = tab(repo);
      assertSha(sha);
      return thenRefresh(root, () => commitOps.cherryPick(root, sha));
    },

    async 'commit:revert'(_ctx, repo, sha) {
      const root = tab(repo);
      assertSha(sha);
      return thenRefresh(root, () => commitOps.revert(root, sha));
    },

    async 'commit:reset'(_ctx, repo, sha, mode) {
      const root = tab(repo);
      assertSha(sha);
      if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') throw new TypeError('mode must be soft, mixed or hard');
      await thenRefresh(root, () => commitOps.reset(root, sha, mode));
    },

    async 'branch:merge'(_ctx, repo, ref, mode, message) {
      const root = tab(repo);
      if (!['default', 'no-ff', 'ff-only', 'squash'].includes(mode as string)) throw new TypeError('unknown merge mode');
      if (message !== null && (typeof message !== 'string' || message.length > 100_000)) throw new TypeError('message must be text or null');
      return thenRefresh(root, () => commitOps.merge(root, parseName(ref, 'ref'), mode, message));
    },

    async 'branch:rebase'(_ctx, repo, onto) {
      const root = tab(repo);
      return thenRefresh(root, () => commitOps.rebase(root, parseName(onto, 'ref')));
    },

    async 'remote:fetch'(_ctx, repo, remote, prune) {
      const root = tab(repo);
      if (remote !== null) parseName(remote, 'remote');
      if (typeof prune !== 'boolean') throw new TypeError('prune must be a boolean');
      await thenRefresh(root, () => network(root, 'fetch', (run) => remotes.fetch(root, remote, prune, run)));
    },

    async 'remote:pull'(_ctx, repo, rebase) {
      const root = tab(repo);
      if (typeof rebase !== 'boolean') throw new TypeError('rebase must be a boolean');
      return thenRefresh(root, () => network(root, 'pull', (run) => remotes.pull(root, rebase, run)));
    },

    async 'remote:push'(_ctx, repo, remote, force) {
      const root = tab(repo);
      if (remote !== null) parseName(remote, 'remote');
      if (typeof force !== 'boolean') throw new TypeError('force must be a boolean');
      try {
        await thenRefresh(root, () => network(root, 'push', (run) => remotes.push(root, remote, force, run)));
      } catch (error) {
        // The window offers pulling or a force push for this case.
        if ((error as { rejected?: boolean }).rejected) throw new Error(`Rejected: ${(error as Error).message}`, { cause: error });
        throw error;
      }
    },

    async 'remote:cancel'(_ctx, repo) {
      running.get(tab(repo))?.abort();
    },

    async 'askpass:answer'(_ctx, id, answer) {
      if (!Number.isInteger(id)) throw new TypeError('id must be a prompt id');
      if (answer !== null && (typeof answer !== 'string' || answer.length > 10_000 || /[\r\n\0]/.test(answer))) throw new TypeError('answer must be one line');
      answerPrompt(id, answer);
    },

    async 'conflict:file'(_ctx, repo, path) {
      const root = tab(repo);
      assertString(path, 'path');
      return conflicts.read(root, normalizeRepoRelative(path));
    },

    async 'conflict:save'(_ctx, repo, path, text, expectedHash, markResolved) {
      const root = tab(repo);
      assertString(path, 'path');
      if (typeof text !== 'string' || text.length > 50 * 1024 * 1024) throw new TypeError('text must be a string');
      if (expectedHash !== null && (typeof expectedHash !== 'string' || !/^[0-9a-f]{64}$/.test(expectedHash))) throw new TypeError('expectedHash must be a hash');
      if (typeof markResolved !== 'boolean') throw new TypeError('markResolved must be a boolean');
      await thenRefresh(root, () => conflicts.save(root, normalizeRepoRelative(path), text, expectedHash, markResolved));
    },

    async 'conflict:take'(_ctx, repo, path, side) {
      const root = tab(repo);
      assertString(path, 'path');
      if (side !== 'ours' && side !== 'theirs') throw new TypeError('side must be ours or theirs');
      await thenRefresh(root, () => conflicts.take(root, normalizeRepoRelative(path), side));
    },

    async 'operation:run'(_ctx, repo, action) {
      const root = tab(repo);
      if (action !== 'continue' && action !== 'abort' && action !== 'skip') throw new TypeError('action must be continue, abort or skip');
      // The operation as git sees it now, not as the window last saw it.
      const data = await git.read(root);
      if (!data.operation) throw new Error('No merge, rebase, cherry-pick or revert is in progress');
      await thenRefresh(root, () => conflicts.operation(root, data.operation!, action));
    },

    async 'stash:push'(_ctx, repo, options) {
      const root = tab(repo);
      if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object');
      const { message, includeUntracked, stagedOnly } = options as Record<string, unknown>;
      if (typeof message !== 'string' || message.length > 10_000 || /[\0\r\n]/.test(message)) throw new TypeError('message must be one line of text');
      if (typeof includeUntracked !== 'boolean' || typeof stagedOnly !== 'boolean') throw new TypeError('flags must be booleans');
      const sha = await thenRefresh(root, () => stashes.push(root, { message, includeUntracked, stagedOnly }));
      return sha !== null;
    },

    async 'stash:apply'(_ctx, repo, sha) {
      const root = tab(repo);
      assertSha(sha);
      const what = stashName(root, sha);
      reportApply(what, false, await thenRefresh(root, () => stashes.apply(root, sha, false)));
    },

    async 'stash:pop'(_ctx, repo, sha) {
      const root = tab(repo);
      assertSha(sha);
      const what = stashName(root, sha);
      reportApply(what, true, await thenRefresh(root, () => stashes.apply(root, sha, true)));
    },

    async 'stash:drop'(_ctx, repo, sha) {
      const root = tab(repo);
      assertSha(sha);
      await thenRefresh(root, () => stashes.drop(root, sha));
    },

    async 'ref:validateName'(_ctx, repo, kind, name) {
      if (kind !== 'branch' && kind !== 'tag') throw new TypeError('kind must be branch or tag');
      return branches.invalidName(tab(repo), kind, parseName(name, kind));
    },

    async 'branch:create'(_ctx, repo, name, sha, checkout) {
      const root = tab(repo);
      if (typeof checkout !== 'boolean') throw new TypeError('checkout must be a boolean');
      assertSha(sha);
      report(await thenRefresh(root, () => branches.create(root, parseName(name, 'branch'), sha, checkout)));
    },

    async 'branch:checkout'(_ctx, repo, target) {
      const root = tab(repo);
      report(await thenRefresh(root, () => branches.checkout(root, parseCheckoutTarget(target))));
    },

    async 'branch:rename'(_ctx, repo, from, to) {
      const root = tab(repo);
      await thenRefresh(root, () => branches.rename(root, parseName(from, 'branch'), parseName(to, 'branch')));
    },

    async 'branch:delete'(_ctx, repo, name, force) {
      const root = tab(repo);
      if (typeof force !== 'boolean') throw new TypeError('force must be a boolean');
      await thenRefresh(root, () => branches.delete(root, parseName(name, 'branch'), force));
    },

    async 'tag:create'(_ctx, repo, name, sha, message) {
      const root = tab(repo);
      assertSha(sha);
      if (message !== null && (typeof message !== 'string' || message.length > 100_000)) throw new TypeError('message must be text or null');
      await thenRefresh(root, () => branches.createTag(root, parseName(name, 'tag'), sha, message?.trim() ? message : null));
    },

    async 'tag:delete'(_ctx, repo, name) {
      const root = tab(repo);
      await thenRefresh(root, () => branches.deleteTag(root, parseName(name, 'tag')));
    },

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

    async 'history:rows'(_ctx, repo, version, start, count) {
      const root = tab(repo);
      if (typeof version !== 'string' || version.length > 64) throw new TypeError('version must be a history version');
      if (!Number.isInteger(start) || start < 0) throw new TypeError('start must be a non-negative integer');
      if (!Number.isInteger(count) || count < 1 || count > MAX_PAGE) throw new TypeError(`count must be 1 to ${MAX_PAGE}`);
      return history.page(root, version, start, count);
    },

    async 'commit:details'(_ctx, repo, sha) {
      const root = tab(repo);
      assertSha(sha);
      // A stash is shown with the untracked files it saved.
      if (repoData(root)?.stashes.some((stash) => stash.sha === sha)) return git.stashDetails(root, sha);
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
      const root = tab(repo);
      store.dispatch(tabClosed(root));
      history.forget(root);
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
