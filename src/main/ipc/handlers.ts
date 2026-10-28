import { isAbsolute, join } from 'node:path';
import { stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Repository } from '@axosoft/nodegit';
import { app, BrowserWindow, dialog, shell, type OpenDialogOptions, type WebContents } from 'electron';
import type { CheckoutTarget } from '../../shared/branches';
import type { DiffTarget } from '../../shared/diff';
import type { HistoryFilter, HistorySearch } from '../../shared/history';
import { t } from '../../shared/i18n';
import type { GitToolKind, ToolKind } from '../../shared/settings';
import type { LineAction, LineActionRequest, LineChange } from '../../shared/staging';
import type { BranchService, SwitchResult } from '../git/branches';
import type { ApplyOutcome, StashService } from '../git/stash';
import type { ConflictService } from '../git/conflicts';
import type { CommitOps } from '../git/commitOps';
import type { BisectService } from '../git/bisect';
import type { InteractiveRebase } from '../git/interactiveRebase';
import type { UndoService } from '../git/undo';
import type { FileHistory } from '../git/fileHistory';
import type { TerminalService } from '../terminal/service';
import { sanitizeEnv } from '../process/env';
import { UndoRecorder } from '../git/undoRecorder';
import type { RebaseStep } from '../../shared/rebase';
import type { RemoteRun, RemoteService } from '../git/remote';
import type { NetworkKind, NetworkOps } from '../repos/network';
import type { DiffTools } from '../external/diffTools';
import type { ExternalTools } from '../external/tools';
import type { GitService } from '../git/service';
import type { StagingService } from '../git/staging';
import { MAX_PAGE, type HistoryService } from '../history/service';
import type { SettingsService } from '../settings/service';
import type { ToolActions } from '../settings/toolActions';
import { normalizeRepoRelative, resolveInsideRepo } from '../repoPaths';
import { cloneActivity, groupSyncChanged, noticeAdded, noticesDismissed, releaseFound, type AppStore } from '../store';
import type { ReleaseCheck } from '../../shared/releases';
import type { RepoScanner } from '../repos/scan';
import { openRepository } from '../repos/open';
import type { RepoCreator } from '../repos/create';
import type { ProfileService } from '../profiles/service';
import type { OperationLog } from '../log/operationLog';
import type { ProcessRunner } from '../process/runner';
import type { AvatarService } from '../avatars/service';
import type { SubmoduleService } from '../git/submodules';
import type { WorktreeService } from '../git/worktrees';
import type { LfsService } from '../git/lfs';
import type { GitflowService } from '../git/gitflow';
import type { GitCli } from '../git/cli';
import type { CredentialStore } from '../askpass/credentials';
import type { HostingService } from '../hosting/service';
import { PROVIDERS, type RepoHosting } from '../../shared/hosting';
import { applicationMemory, runningGitCommands } from '../status';
import { favoriteToggled, groupChanged, groupCreated, groupRemoved, repoForgotten } from '../store/librarySlice';
import { bisectActivity, hookActivity, loadRepo, tabActivated, tabClosed, tabMoved } from '../store/reposSlice';
import { listHooks } from '../git/hooks';
import { COMMIT_HOOKS, PUSH_HOOKS, type HookActivity } from '../../shared/hooks';
import { settingsProblemsDismissed } from '../store/settingsSlice';
import type { CommandHandlers } from './registry';
import { MAX_GROUPS, MAX_GROUP_REPOS } from '../../shared/state';
import { GroupSyncRunner, readGroupStatus } from '../repos/groupSync';
import { askAi } from '../ai/assist';
import type { TokenStore } from '../hosting/tokens';

export interface HandlerDeps {
  store: AppStore;
  checkRelease(): Promise<ReleaseCheck>;
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
  bisect: BisectService;
  remotes: RemoteService;
  networkOps: NetworkOps;
  interactiveRebase: InteractiveRebase;
  undo: UndoService;
  fileHistory: FileHistory;
  terminals: TerminalService;
  creator: RepoCreator;
  profiles: ProfileService;
  log: OperationLog;
  avatars: AvatarService;
  submodules: SubmoduleService;
  worktrees: WorktreeService;
  lfs: LfsService;
  gitflow: GitflowService;
  /** The git CLI (hooks listing). */
  gitCli: GitCli;
  /** The environment shells start with (the user's login-shell environment once resolved). */
  shellEnv(): Promise<Record<string, string>>;
  /** Told about fetches done by hand (they reset the auto-fetch clock). */
  onFetched?(root: string): void;
  /** Working-tree files of a repository (tracked and untracked, not ignored). */
  listFiles(root: string): Promise<{ paths: string[]; truncated: boolean }>;
  /** Hands a credential answer to the waiting git process. */
  answerPrompt(id: number, answer: string | null, remember: boolean): void;
  credentials: Pick<CredentialStore, 'list' | 'remove'>;
  hosting: HostingService;
  aiTokens: Pick<TokenStore, 'available' | 'get' | 'set' | 'remove'>;
  aiFetch: typeof fetch;
  /** External processes running through the shared process host. */
  processes: Pick<ProcessRunner, 'running' | 'cancel' | 'run'>;
}

// Arguments arrive from the renderer and are validated at runtime despite the typed contract.
function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
}

function assertSha(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(value)) throw new TypeError('sha must be a full commit hash');
}

/** Paths in one request: a whole working tree of a large repository (they go to git through stdin). */
const MAX_PATHS = 1_000_000;

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
  if (raw['kind'] === 'comparison') {
    assertSha(raw['base']);
    assertSha(raw['head']);
    return { kind: 'comparison', base: raw['base'], head: raw['head'], ...paths };
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

const MAX_TEXT = 65_536;

function parseText(value: unknown, what: string, required: boolean): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT || (required && !value.trim())) throw new TypeError(`${what} must be text${required ? ' (not empty)' : ''}`);
  return value;
}

function assertNumber(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new TypeError('number must be a pull request or issue number');
}

function parseState(value: unknown): 'open' | 'closed' | 'all' {
  if (value !== 'open' && value !== 'closed' && value !== 'all') throw new TypeError('state must be open, closed or all');
  return value;
}

function assertVersion(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 64) throw new TypeError('version must be a history version');
}

function parseFilter(value: unknown): HistoryFilter {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const refs = (list: unknown) => {
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.length > 1000 || !list.every((ref) => typeof ref === 'string' && /^refs\/[^\s]{1,250}$/.test(ref))) throw new TypeError('filter refs must be full ref names');
    return list as string[];
  };
  return { solo: refs(raw['solo']), hidden: refs(raw['hidden']) };
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

export function createCommandHandlers({ store, checkRelease, git, tools, diffTools, staging, settings, toolActions, scanner, history, branches, stashes, conflicts, commitOps, bisect, remotes, networkOps, interactiveRebase, undo, fileHistory, terminals, creator, profiles, log, avatars, submodules, worktrees, lfs, gitflow, gitCli, credentials, hosting, aiTokens, aiFetch, processes, listFiles, shellEnv, onFetched, answerPrompt }: HandlerDeps): CommandHandlers {
  const effective = (root: string) => settings.effective(root);
  let cloning: AbortController | null = null;
  const aiRequests = new Map<string, { sender: number; controller: AbortController }>();
  const isOpen = (id: string) => Boolean(store.getState().repos.byId[id]);

  /** The tab named by the window; operations always say which repository they mean. */
  const tab = (id: unknown): string => {
    assertString(id, 'repo');
    if (!isOpen(id)) throw new Error('This repository is not open');
    return id;
  };
  const optionalTab = (id: unknown): string | null => (id === null ? null : tab(id));
  const repoData = (id: string) => store.getState().repos.byId[id]?.data ?? null;
  const historySizes = new Map<string, { version: string; value: Promise<number | null> }>();

  const historySize = (root: string): Promise<number | null> => {
    const data = repoData(root);
    if (!data) return Promise.resolve(null);
    const cached = historySizes.get(root);
    if (cached?.version === data.historyVersion) return cached.value;
    // `--all` covers every visible ref; HEAD also keeps a detached commit in the count.
    const revisions = data.branch.oid ? ['--all', 'HEAD'] : ['--all'];
    let value: Promise<number | null>;
    value = gitCli
      .exec(['rev-list', '--count', ...revisions], { cwd: root, readOnly: true })
      .then(({ stdout }) => {
        const count = Number(stdout.trim());
        return Number.isSafeInteger(count) && count >= 0 ? count : null;
      })
      .catch(() => {
        if (historySizes.get(root)?.value === value) historySizes.delete(root);
        return null;
      });
    historySizes.set(root, { version: data.historyVersion, value });
    return value;
  };

  const lastFetch = async (root: string): Promise<number | null> => {
    try {
      const repo = await Repository.open(root);
      return (await stat(join(repo.path(), 'FETCH_HEAD'))).mtimeMs;
    } catch {
      return null;
    }
  };

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

  const recorder = new UndoRecorder(undo);
  const groupSync = new GroupSyncRunner(store, git, gitCli, remotes, networkOps);
  const getGroup = (id: unknown) => {
    assertString(id, 'group id');
    const group = store.getState().library.groups.find((item) => item.id === id);
    if (!group) throw new Error(t('Repository group not found'));
    return group;
  };

  /** The tab's repository on its server; commands for pull requests and issues need one. */
  const hostingOf = async (root: string): Promise<RepoHosting & { client: Awaited<ReturnType<HostingService['client']>> }> => {
    const context = await hosting.context(root, repoData(root)?.remoteUrls ?? {});
    if (!context) throw new Error(t('None of this repository\'s remotes is on a server added in Preferences → Integrations'));
    return { ...context, client: await hosting.client(context.account) };
  };

  /** While `work` runs, the tab shows which of `names` hooks exist and run, and their output (last 200 lines). */
  const withHooks = async <T>(root: string, operation: HookActivity['operation'], names: string[], work: (onOutput?: (line: string) => void) => Promise<T>): Promise<T> => {
    const present = (await listHooks(gitCli, root).catch(() => ({ hooks: [] as string[] }))).hooks.filter((hook) => names.includes(hook));
    if (!present.length) return work();
    let output: string[] = [];
    let timer: NodeJS.Timeout | null = null;
    const publish = () => {
      timer = null;
      store.dispatch(hookActivity({ id: root, activity: { operation, hooks: present, output } }));
    };
    publish();
    try {
      return await work((line) => {
        output = [...output, line].slice(-200);
        timer ??= setTimeout(publish, 100);
      });
    } finally {
      if (timer) clearTimeout(timer);
      store.dispatch(hookActivity({ id: root, activity: null }));
    }
  };
  const network = <T>(root: string, kind: NetworkKind, work: (run: RemoteRun) => Promise<T>) => networkOps.run(root, kind, work);

  const stashName = (root: string, sha: string) => {
    const stash = repoData(root)?.stashes.find((s) => s.sha === sha);
    return stash ? `stash@{${stash.index}} (${stash.message})` : t('the stash');
  };
  const reportApply = (what: string, popped: boolean, { outcome, detail }: ApplyOutcome) => {
    if (outcome === 'applied-unstaged') store.dispatch(noticeAdded(t('Applied {stash}, but what was staged in it is now unstaged.', { stash: what })));
    else if (outcome === 'conflicts') {
      store.dispatch(noticeAdded(popped
        ? t('Applied {stash} with conflicts in {detail}; resolve them. The stash is kept.', { stash: what, detail: detail ?? '' })
        : t('Applied {stash} with conflicts in {detail}; resolve them.', { stash: what, detail: detail ?? '' })));
    } else if (outcome === 'failed') store.dispatch(noticeAdded(t('Could not apply {stash}: {detail}. The stash is unchanged.', { stash: what, detail: detail ?? '' })));
  };

  return {
    async 'bisect:status'(_ctx, repo) { return bisect.status(tab(repo)); },
    async 'bisect:mark'(_ctx, repo, mark, sha) {
      const root = tab(repo);
      assertSha(sha);
      if (mark !== 'good' && mark !== 'bad' && mark !== 'skip') throw new TypeError('Invalid bisect mark');
      if (repoData(root)?.operation) throw new Error('Finish the current Git operation first');
      await thenRefresh(root, () => bisect.mark(root, mark, sha));
    },
    async 'bisect:run'(_ctx, repo, executable, args) {
      const root = tab(repo);
      if (typeof executable !== 'string' || !Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) throw new TypeError('Invalid bisect command');
      let timer: NodeJS.Timeout | null = null;
      let latest: { running: boolean; output: string[] } = { running: true, output: [] };
      const publish = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        store.dispatch(bisectActivity({ id: root, activity: latest }));
      };
      await thenRefresh(root, () => bisect.run(root, executable, args, (activity) => {
        latest = activity;
        if (!activity.running) publish();
        else timer ??= setTimeout(publish, 100);
      }));
    },
    async 'bisect:cancel'(_ctx, repo) { bisect.cancel(tab(repo)); },
    async 'bisect:reset'(_ctx, repo) { const root = tab(repo); await thenRefresh(root, () => bisect.reset(root)); store.dispatch(bisectActivity({ id: root, activity: null })); },
    async 'bisect:clearOutput'(_ctx, repo) { store.dispatch(bisectActivity({ id: tab(repo), activity: null })); },
    async 'commit:cherryPick'(_ctx, repo, sha) {
      const root = tab(repo);
      assertSha(sha);
      return thenRefresh(root, () => recorder.history(root, t('cherry-pick of {sha}', { sha: sha.slice(0, 7) }), () => commitOps.cherryPick(root, sha)));
    },

    async 'commit:rangePreview'(_ctx, repo, from, to) {
      const root = tab(repo);
      assertSha(from);
      assertSha(to);
      return commitOps.previewRange(root, from, to);
    },

    async 'commit:rangeApply'(_ctx, repo, from, to, action) {
      const root = tab(repo);
      assertSha(from);
      assertSha(to);
      if (action !== 'cherry-pick' && action !== 'revert') throw new TypeError('action must be cherry-pick or revert');
      let counts = { applied: 0, total: 0 };
      const result = await thenRefresh(root, () => recorder.history(
        root,
        t('Apply commit range ({action})', { action: action === 'cherry-pick' ? t('Cherry-pick') : t('Revert') }),
        async () => {
          const range = await commitOps.applyRange(root, from, to, action);
          counts = { applied: range.applied, total: range.total };
          return range.result;
        },
      ));
      return { result, ...counts };
    },

    async 'commit:revert'(_ctx, repo, sha) {
      const root = tab(repo);
      assertSha(sha);
      return thenRefresh(root, () => recorder.history(root, t('revert of {sha}', { sha: sha.slice(0, 7) }), () => commitOps.revert(root, sha)));
    },

    async 'commit:reset'(_ctx, repo, sha, mode) {
      const root = tab(repo);
      assertSha(sha);
      if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') throw new TypeError('mode must be soft, mixed or hard');
      await thenRefresh(root, () => recorder.reset(root, mode, () => commitOps.reset(root, sha, mode)));
    },

    async 'branch:merge'(_ctx, repo, ref, mode, message) {
      const root = tab(repo);
      if (!['default', 'no-ff', 'ff-only', 'squash'].includes(mode as string)) throw new TypeError('unknown merge mode');
      if (message !== null && (typeof message !== 'string' || message.length > 100_000)) throw new TypeError('message must be text or null');
      const name = parseName(ref, 'ref');
      return thenRefresh(root, () => recorder.history(root, t('merge of {ref}', { ref: name.length === 40 ? name.slice(0, 7) : name }), () => commitOps.merge(root, name, mode, message)));
    },

    async 'branch:rebase'(_ctx, repo, onto) {
      const root = tab(repo);
      const name = parseName(onto, 'ref');
      return thenRefresh(root, () => recorder.history(root, t('rebase onto {ref}', { ref: name.length === 40 ? name.slice(0, 7) : name }), () => commitOps.rebase(root, name)));
    },

    async 'remote:fetch'(_ctx, repo, remote, prune) {
      const root = tab(repo);
      if (remote !== null) parseName(remote, 'remote');
      if (typeof prune !== 'boolean') throw new TypeError('prune must be a boolean');
      await thenRefresh(root, () => network(root, 'fetch', (run) => remotes.fetch(root, remote, prune, run)));
      onFetched?.(root);
    },

    async 'remote:pull'(_ctx, repo, rebase) {
      const root = tab(repo);
      if (typeof rebase !== 'boolean') throw new TypeError('rebase must be a boolean');
      const result = await thenRefresh(root, () => recorder.history(root, t('undo-action|pull'), () => network(root, 'pull', (run) => remotes.pull(root, rebase, run))));
      onFetched?.(root);
      return result;
    },

    async 'remote:push'(_ctx, repo, remote, force) {
      const root = tab(repo);
      if (remote !== null) parseName(remote, 'remote');
      if (typeof force !== 'boolean') throw new TypeError('force must be a boolean');
      try {
        await thenRefresh(root, () => withHooks(root, 'push', [...PUSH_HOOKS], (onOutput) => network(root, 'push', (run) => remotes.push(root, remote, force, { ...run, onOutput }))));
      } catch (error) {
        // The window offers pulling or a force push for this case.
        if ((error as { rejected?: boolean }).rejected) throw new Error(t('Rejected: {message}', { message: (error as Error).message }), { cause: error });
        throw error;
      }
    },

    async 'remote:add'(_ctx, repo, name, url) {
      const root = tab(repo);
      await thenRefresh(root, () => remotes.addRemote(root, parseName(name, 'remote'), String(url)));
    },

    async 'remote:rename'(_ctx, repo, from, to) {
      const root = tab(repo);
      await thenRefresh(root, () => remotes.renameRemote(root, parseName(from, 'remote'), parseName(to, 'remote')));
    },

    async 'remote:setUrl'(_ctx, repo, name, url, push) {
      const root = tab(repo);
      if (typeof push !== 'boolean' || typeof url !== 'string') throw new TypeError('url must be text and push a boolean');
      await thenRefresh(root, () => remotes.setRemoteUrl(root, parseName(name, 'remote'), url, push));
    },

    async 'remote:remove'(_ctx, repo, name) {
      const root = tab(repo);
      await thenRefresh(root, () => remotes.removeRemote(root, parseName(name, 'remote')));
    },

    async 'undo:undo'(_ctx, repo) {
      const root = tab(repo);
      return thenRefresh(root, () => undo.undo(root));
    },

    async 'undo:redo'(_ctx, repo) {
      const root = tab(repo);
      return thenRefresh(root, () => undo.redo(root));
    },

    async 'remote:cancel'(_ctx, repo) {
      networkOps.cancel(tab(repo));
    },

    async 'askpass:answer'(_ctx, id, answer, remember) {
      if (!Number.isInteger(id)) throw new TypeError('id must be a prompt id');
      if (answer !== null && (typeof answer !== 'string' || answer.length > 10_000 || /[\r\n\0]/.test(answer))) throw new TypeError('answer must be one line');
      if (remember !== undefined && typeof remember !== 'boolean') throw new TypeError('remember must be a boolean');
      answerPrompt(id, answer, remember === true);
    },

    async 'credentials:list'() {
      return credentials.list();
    },

    async 'credentials:remove'(_ctx, id) {
      assertString(id, 'id');
      await credentials.remove(id);
    },

    async 'hosting:add'(_ctx, provider, url, token) {
      if (typeof provider !== 'string' || !Object.hasOwn(PROVIDERS, provider)) throw new TypeError('unknown service');
      assertString(url, 'url');
      assertString(token, 'token');
      return hosting.add(provider, url, token);
    },

    async 'hosting:remove'(_ctx, accountId) {
      assertString(accountId, 'account');
      await hosting.remove(accountId);
    },

    async 'hosting:repos'(_ctx, accountId) {
      assertString(accountId, 'account');
      return hosting.repos(accountId);
    },

    async 'hosting:context'(_ctx, repo) {
      const root = tab(repo);
      return hosting.context(root, repoData(root)?.remoteUrls ?? {});
    },

    async 'hosting:pulls'(_ctx, repo, state) {
      const { client, owner, name } = await hostingOf(tab(repo));
      return client.pulls(owner, name, parseState(state));
    },

    async 'hosting:pull'(_ctx, repo, number) {
      assertNumber(number);
      const { client, owner, name } = await hostingOf(tab(repo));
      return client.pull(owner, name, number);
    },

    async 'hosting:createPull'(_ctx, repo, pull) {
      if (typeof pull !== 'object' || pull === null) throw new TypeError('pull must be an object');
      const raw = pull as unknown as Record<string, unknown>;
      const request = { head: parseName(raw['head'], 'head'), base: parseName(raw['base'], 'base'), title: parseText(raw['title'], 'title', true), body: parseText(raw['body'], 'description', false) };
      const { client, owner, name } = await hostingOf(tab(repo));
      return client.createPull(owner, name, request);
    },

    async 'hosting:checkoutPull'(_ctx, repo, number) {
      const root = tab(repo);
      assertNumber(number);
      const { client, owner, name, remote, account } = await hostingOf(root);
      const pull = await client.pullSummary(owner, name, number);
      if (!pull.headRepo) {
        // A branch of this repository: fetch it and switch to it (a tracking branch when there is none yet).
        const head = parseName(pull.head, 'branch');
        await thenRefresh(root, async () => {
          await network(root, 'fetch', (run) => remotes.networkCommand(root, ['fetch', '--progress', remote, `+refs/heads/${head}:refs/remotes/${remote}/${head}`], run));
          const local = repoData(root)?.branches.some((branch) => branch.name === head);
          const target = local ? ({ kind: 'branch', name: head } as const) : ({ kind: 'remote', name: `${remote}/${head}`, remote } as const);
          report(await recorder.checkout(root, target, () => branches.checkout(root, target)));
        });
        return;
      }
      // From a fork: the server keeps its commits under a ref of its own (refs/pull/<number>/head,
      // refs/merge-requests/<number>/head); a local branch pr/<number> holds them.
      const local = `pr/${number}`;
      await thenRefresh(root, async () => {
        await network(root, 'fetch', async (run) => {
          try {
            await remotes.networkCommand(root, ['fetch', '--progress', remote, client.pullRef(number)], run);
          } catch (error) {
            // Not every service publishes the pull request's ref: then the fork's branch itself, from the same server only
            // (the URL comes from the server; git must not be pointed at another host or transport).
            const fork = pull.headCloneUrl ? new URL(pull.headCloneUrl) : null;
            const server = new URL(account.url);
            if (run.signal.aborted || !fork || fork.protocol !== server.protocol || fork.host !== server.host || fork.username || fork.password) throw error;
            await remotes.networkCommand(root, ['fetch', '--progress', fork.href, `refs/heads/${parseName(pull.head, 'branch')}`], run);
          }
        });
        if (repoData(root)?.branches.some((branch) => branch.name === local)) {
          store.dispatch(noticeAdded(t('The branch {branch} already exists: it was checked out as it is, not moved to the pull request\'s latest commit.', { branch: local })));
          report(await recorder.checkout(root, { kind: 'branch', name: local }, () => branches.checkout(root, { kind: 'branch', name: local })));
          return;
        }
        const sha = (await gitCli.exec(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], { cwd: root })).stdout.trim();
        report(await recorder.createBranch(root, local, sha, true, () => branches.create(root, local, sha, true)));
      });
    },

    async 'hosting:issues'(_ctx, repo, state) {
      const { client, owner, name } = await hostingOf(tab(repo));
      return client.issues(owner, name, parseState(state));
    },

    async 'hosting:issue'(_ctx, repo, number) {
      assertNumber(number);
      const { client, owner, name } = await hostingOf(tab(repo));
      return client.issue(owner, name, number);
    },

    async 'hosting:createIssue'(_ctx, repo, issue) {
      if (typeof issue !== 'object' || issue === null) throw new TypeError('issue must be an object');
      const raw = issue as unknown as Record<string, unknown>;
      const request = { title: parseText(raw['title'], 'title', true), body: parseText(raw['body'], 'description', false) };
      const { client, owner, name } = await hostingOf(tab(repo));
      return client.createIssue(owner, name, request);
    },

    async 'hosting:comment'(_ctx, repo, kind, number, body) {
      if (kind !== 'pull' && kind !== 'issue') throw new TypeError('kind must be pull or issue');
      assertNumber(number);
      const text = parseText(body, 'comment', true);
      const { client, owner, name } = await hostingOf(tab(repo));
      return client.comment(owner, name, kind, number, text);
    },

    async 'rebase:plan'(_ctx, repo, base) {
      const root = tab(repo);
      assertSha(base);
      return interactiveRebase.plan(root, base);
    },

    async 'rebase:interactive'(_ctx, repo, base, steps) {
      const root = tab(repo);
      assertSha(base);
      if (!Array.isArray(steps) || steps.length > 10_000) throw new TypeError('steps must be an array');
      const parsed: RebaseStep[] = steps.map((step: unknown) => {
        const raw = (typeof step === 'object' && step !== null ? step : {}) as Record<string, unknown>;
        assertSha(raw['sha']);
        if (!['pick', 'reword', 'squash', 'fixup', 'drop'].includes(raw['action'] as string)) throw new TypeError('unknown rebase action');
        if (raw['message'] !== undefined && (typeof raw['message'] !== 'string' || raw['message'].length > 100_000)) throw new TypeError('message must be text');
        return { sha: raw['sha'], action: raw['action'] as RebaseStep['action'], ...(raw['message'] !== undefined && { message: raw['message'] as string }) };
      });
      return thenRefresh(root, () => recorder.history(root, t('interactive rebase'), () => interactiveRebase.run(root, base, parsed)));
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
      if (!data.operation) throw new Error(t('No merge, rebase, cherry-pick or revert is in progress'));
      await thenRefresh(root, () => conflicts.operation(root, data.operation!, action));
    },

    async 'stash:push'(_ctx, repo, options) {
      const root = tab(repo);
      if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object');
      const { message, includeUntracked, stagedOnly } = options as Record<string, unknown>;
      if (typeof message !== 'string' || message.length > 10_000 || /[\0\r\n]/.test(message)) throw new TypeError('message must be one line of text');
      if (typeof includeUntracked !== 'boolean' || typeof stagedOnly !== 'boolean') throw new TypeError('flags must be booleans');
      const sha = await thenRefresh(root, () => recorder.stashPush(root, () => stashes.push(root, { message, includeUntracked, stagedOnly })));
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
      const stash = repoData(root)?.stashes.find((s) => s.sha === sha);
      await thenRefresh(root, () => recorder.stashDrop(root, sha, stash?.message ?? t('Restored stash'), () => stashes.drop(root, sha)));
    },

    async 'ref:validateName'(_ctx, repo, kind, name) {
      if (kind !== 'branch' && kind !== 'tag') throw new TypeError('kind must be branch or tag');
      return branches.invalidName(tab(repo), kind, parseName(name, kind));
    },

    async 'branch:create'(_ctx, repo, name, sha, checkout) {
      const root = tab(repo);
      if (typeof checkout !== 'boolean') throw new TypeError('checkout must be a boolean');
      assertSha(sha);
      const branch = parseName(name, 'branch');
      report(await thenRefresh(root, () => recorder.createBranch(root, branch, sha, checkout, () => branches.create(root, branch, sha, checkout))));
    },

    async 'branch:mergedLocal'(_ctx, repo) {
      const root = tab(repo);
      return branches.mergedLocalBranches(root);
    },

    async 'branch:checkout'(_ctx, repo, target) {
      const root = tab(repo);
      const parsed = parseCheckoutTarget(target);
      report(await thenRefresh(root, () => recorder.checkout(root, parsed, () => branches.checkout(root, parsed))));
    },

    async 'branch:setUpstream'(_ctx, repo, branch, upstream) {
      const root = tab(repo);
      const name = parseName(branch, 'branch');
      const target = upstream === null ? null : parseName(upstream, 'upstream');
      await thenRefresh(root, () => branches.setUpstream(root, name, target));
    },

    async 'branch:rename'(_ctx, repo, from, to) {
      const root = tab(repo);
      const [a, b] = [parseName(from, 'branch'), parseName(to, 'branch')];
      await thenRefresh(root, () => recorder.renameBranch(root, a, b, () => branches.rename(root, a, b)));
    },

    async 'branch:delete'(_ctx, repo, name, force) {
      const root = tab(repo);
      if (typeof force !== 'boolean') throw new TypeError('force must be a boolean');
      const branch = parseName(name, 'branch');
      await thenRefresh(root, () => recorder.deleteBranch(root, branch, () => branches.delete(root, branch, force)));
    },

    async 'tag:create'(_ctx, repo, name, sha, message) {
      const root = tab(repo);
      assertSha(sha);
      if (message !== null && (typeof message !== 'string' || message.length > 100_000)) throw new TypeError('message must be text or null');
      const tagName = parseName(name, 'tag');
      await thenRefresh(root, () => recorder.tag(root, tagName, true, () => branches.createTag(root, tagName, sha, message?.trim() ? message : null)));
    },

    async 'tag:delete'(_ctx, repo, name) {
      const root = tab(repo);
      const tagName = parseName(name, 'tag');
      await thenRefresh(root, () => recorder.tag(root, tagName, false, () => branches.deleteTag(root, tagName)));
    },

    async 'tag:push'(_ctx, repo, name, remote) {
      const root = tab(repo);
      const tagName = parseName(name, 'tag');
      const remoteName = parseName(remote, 'remote');
      await thenRefresh(root, () => network(root, 'push', (run) => remotes.networkCommand(root, ['push', '--progress', '--porcelain', remoteName, `refs/tags/${tagName}:refs/tags/${tagName}`], run)));
    },

    async 'tag:deleteRemote'(_ctx, repo, name, remote) {
      const root = tab(repo);
      const tagName = parseName(name, 'tag');
      const remoteName = parseName(remote, 'remote');
      await thenRefresh(root, () => network(root, 'push', (run) => remotes.networkCommand(root, ['push', '--progress', '--porcelain', remoteName, `:refs/tags/${tagName}`], run)));
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
      const moved: string[] = [];
      for (const path of parsePaths(paths)) {
        const change = changes.get(path);
        if (change === undefined) throw new Error(t('{path} has no changes to discard', { path }));
        if (change.kind === 'conflicted') throw new Error(t('{path} is in conflict; resolve it instead of discarding', { path }));
        (change.submodule ? moved : change.kind === 'untracked' ? untracked : tracked).push(path);
      }
      await thenRefresh(root, async () => {
        // A submodule goes back to the commit the repository records (changes inside it stay).
        if (moved.length) await submodules.restore(root, moved);
        if (tracked.length || untracked.length) await recorder.discard(root, tracked, untracked, () => staging.discardFiles(root, tracked, untracked));
      });
    },

    async 'index:applyLines'(_ctx, repo, request) {
      const root = tab(repo);
      await thenRefresh(root, () => staging.applyLines(root, parseLineActionRequest(request)));
    },

    async 'commit:create'(_ctx, repo, message, amend, options) {
      const root = tab(repo);
      if (typeof message !== 'string' || message.trim() === '') throw new TypeError('Commit message is empty');
      if (typeof amend !== 'boolean') throw new TypeError('amend must be a boolean');
      const skipHooks = options === undefined ? false : (options as { skipHooks?: unknown } | null)?.skipHooks;
      if (skipHooks !== undefined && typeof skipHooks !== 'boolean') throw new TypeError('skipHooks must be a boolean');
      const subject = message.trim().split('\n')[0]!.slice(0, 60);
      // With --no-verify only prepare-commit-msg and post-commit still run.
      const hooks = skipHooks ? ['prepare-commit-msg', 'post-commit'] : [...COMMIT_HOOKS];
      return thenRefresh(root, () =>
        withHooks(root, 'commit', hooks, (onOutput) =>
          recorder.commit(root, amend ? t('amend “{subject}”', { subject }) : t('commit “{subject}”', { subject }), () => staging.commit(root, message, amend, { skipHooks: skipHooks === true, onOutput })),
        ),
      );
    },

    async 'ai:assist'(ctx, repo, task, requestId, confirmedProvider, target) {
      const root = tab(repo);
      if (task !== 'message' && task !== 'review' && task !== 'conflict' && task !== 'commit') throw new TypeError('Unknown AI task');
      if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId) || aiRequests.has(requestId)) throw new TypeError('Invalid AI request ID');
      if (task === 'conflict' && typeof target !== 'string') throw new TypeError('Conflict path is required');
      if (task === 'commit') assertSha(target);
      const setting = effective(root);
      const provider = setting['ai.provider'];
      if (provider !== 'ollama' && provider !== 'openai' && provider !== 'codex' && provider !== 'claude' && provider !== 'opencode' && provider !== 'qwen') throw new Error('Choose an AI provider in Preferences first');
      if (confirmedProvider !== provider) throw new Error('AI provider changed since confirmation; confirm the request again');
      const key = provider === 'openai' ? await aiTokens.get('openai', 'https://api.openai.com') : undefined;
      if (provider === 'openai' && !key) throw new Error('Add your OpenAI API key in Preferences first');
      const controller = new AbortController();
      const onClosed = () => controller.abort();
      ctx.sender.once('destroyed', onClosed);
      aiRequests.set(requestId, { sender: ctx.sender.id, controller });
      try {
        return await askAi(processes, gitCli.executable, { repo: root, task, provider, model: provider === 'ollama' ? setting['ai.model'] : setting['ai.openaiModel'], ...(key && { apiKey: key }), ...(task === 'conflict' && { path: normalizeRepoRelative(target!) }), ...(task === 'commit' && { sha: target }), signal: controller.signal }, aiFetch);
      } finally {
        ctx.sender.removeListener('destroyed', onClosed);
        aiRequests.delete(requestId);
      }
    },
    async 'ai:cancel'(ctx, requestId) {
      const request = aiRequests.get(requestId);
      if (request?.sender === ctx.sender.id) request.controller.abort();
    },
    async 'ai:keyStatus'() {
      const available = await aiTokens.available();
      return { available, saved: available && Boolean(await aiTokens.get('openai', 'https://api.openai.com')) };
    },
    async 'ai:keySet'(_ctx, key) {
      if (typeof key !== 'string' || key.trim().length < 10 || key.length > 512 || /[\r\n]/.test(key)) throw new TypeError('Invalid API key');
      await aiTokens.set('openai', 'https://api.openai.com', key.trim());
    },
    async 'ai:keyRemove'() { await aiTokens.remove('openai'); },

    async 'hooks:list'(_ctx, repo) {
      return listHooks(gitCli, tab(repo));
    },

    async 'history:rows'(_ctx, repo, version, start, count, filter) {
      const root = tab(repo);
      assertVersion(version);
      if (!Number.isInteger(start) || start < 0) throw new TypeError('start must be a non-negative integer');
      if (!Number.isInteger(count) || count < 1 || count > MAX_PAGE) throw new TypeError(`count must be 1 to ${MAX_PAGE}`);
      return history.page(root, version, start, count, parseFilter(filter));
    },

    async 'history:locate'(_ctx, repo, version, filter, sha) {
      const root = tab(repo);
      assertVersion(version);
      assertSha(sha);
      return history.locate(root, version, parseFilter(filter), sha);
    },

    async 'history:search'(_ctx, repo, version, filter, query) {
      const root = tab(repo);
      assertVersion(version);
      const raw = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
      if (!['message', 'author', 'sha', 'file', 'content'].includes(raw['field'] as string)) throw new TypeError('unknown search field');
      if (typeof raw['text'] !== 'string' || raw['text'].length > 1000 || /[\0\n]/.test(raw['text'])) throw new TypeError('search text must be one line');
      return history.search(root, version, parseFilter(filter), { field: raw['field'] as HistorySearch['field'], text: raw['text'] });
    },

    async 'history:find'(_ctx, repo, version, filter, text) {
      const root = tab(repo);
      assertVersion(version);
      if (typeof text !== 'string' || text.length > 200 || /[\0\n]/.test(text)) throw new TypeError('text must be one line');
      return history.find(root, version, parseFilter(filter), text);
    },

    async 'repo:files'(_ctx, repo) {
      return listFiles(tab(repo));
    },

    async 'commit:details'(_ctx, repo, sha) {
      const root = tab(repo);
      assertSha(sha);
      // A stash is shown with the untracked files it saved.
      if (repoData(root)?.stashes.some((stash) => stash.sha === sha)) return git.stashDetails(root, sha);
      return git.commitDetails(root, sha);
    },

    async 'comparison:details'(_ctx, repo, left, right, mode) {
      const root = tab(repo);
      assertSha(left);
      assertSha(right);
      if (mode !== 'direct' && mode !== 'merge-base') throw new TypeError('unknown comparison mode');
      let base = left;
      if (mode === 'merge-base') {
        const result = await gitCli.exec(['merge-base', left, right], { cwd: root, readOnly: true, allowedExitCodes: [1] });
        if (result.exitCode !== 0) throw new Error(t('The commits have no common ancestor'));
        base = result.stdout.trim();
        assertSha(base);
      }
      return git.comparisonDetails(root, left, right, base, mode);
    },

    async 'diff:file'(_ctx, repo, target) {
      return git.fileDiff(tab(repo), parseDiffTarget(target));
    },

    async 'repo:pick'({ sender }, purpose) {
      const title = purpose === 'scan' ? t('Choose a folder to search for repositories') : purpose === 'parent' ? t('Choose a folder') : t('Open repository');
      return showOpenDialog(sender, { title, properties: ['openDirectory', ...(purpose === 'parent' ? (['createDirectory'] as const) : [])] });
    },

    async 'repo:createDefaults'() {
      return creator.defaults();
    },

    async 'repo:checkTarget'(_ctx, kind, parent, name) {
      if (kind !== 'clone' && kind !== 'init') throw new TypeError('kind must be clone or init');
      return creator.targetProblem(kind, parent, name);
    },

    async 'repo:clone'(_ctx, request) {
      if (typeof request !== 'object' || request === null) throw new TypeError('request must be an object');
      const { url, parent, name, recurseSubmodules } = request as unknown as Record<string, unknown>;
      if (recurseSubmodules !== undefined && typeof recurseSubmodules !== 'boolean') throw new TypeError('recurseSubmodules must be a boolean');
      assertString(url, 'url');
      assertAbsolutePath(parent, 'parent');
      assertString(name, 'name');
      if (cloning) throw new Error(t('A clone is already running'));
      const controller = new AbortController();
      cloning = controller;
      let last = 0;
      const target = await creator.cloneTarget(parent, name).catch((error: unknown) => {
        cloning = null;
        throw error;
      });
      store.dispatch(cloneActivity({ url, target, phase: null, percent: null }));
      try {
        const root = await creator.clone({ url, parent, name, recurseSubmodules: recurseSubmodules === true }, {
          signal: controller.signal,
          onProgress: ({ phase, percent }) => {
            const now = Date.now();
            if (now - last < 100 && percent !== 100) return;
            last = now;
            store.dispatch(cloneActivity({ url, target, phase, percent }));
          },
        });
        return await openRepository(store, git, root);
      } catch (error) {
        if (controller.signal.aborted) throw new Error(t('The clone was cancelled'), { cause: error });
        throw error;
      } finally {
        cloning = null;
        store.dispatch(cloneActivity(null));
      }
    },

    async 'repo:cancelClone'() {
      cloning?.abort();
    },

    async 'repo:init'(_ctx, request) {
      if (typeof request !== 'object' || request === null) throw new TypeError('request must be an object');
      const raw = request as unknown as Record<string, unknown>;
      if (typeof raw['initialCommit'] !== 'boolean') throw new TypeError('initialCommit must be a boolean');
      const { root, warning } = await creator.init(request);
      if (warning) store.dispatch(noticeAdded(warning));
      return openRepository(store, git, root);
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

    async 'repo:writeCommitGraph'(_ctx, repo) {
      const root = tab(repo);
      // Only git's own optional file under objects/info: no ref, index or working tree is touched.
      await thenRefresh(root, () => gitCli.exec(['commit-graph', 'write', '--reachable', '--no-progress'], { cwd: root }));
    },

    async 'repo:refresh'(_ctx, repo) {
      await store.dispatch(loadRepo(tab(repo))).unwrap();
    },

    async 'repo:close'(_ctx, repo) {
      const root = tab(repo);
      store.dispatch(tabClosed(root));
      history.forget(root);
      historySizes.delete(root);
      terminals.closeRepo(root);
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

    async 'repos:groupCreate'(_ctx, name) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new TypeError('Group name must contain 1–100 characters');
      const groups = store.getState().library.groups;
      if (groups.length >= MAX_GROUPS) throw new Error(t('The maximum number of repository groups has been reached'));
      const group = { id: randomUUID(), name: name.trim(), color: groups.length % 10, repos: [] };
      store.dispatch(groupCreated(group));
      return group;
    },

    async 'repos:groupUpdate'(_ctx, id, patch) {
      const group = getGroup(id);
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new TypeError('Group changes must be an object');
      if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.trim().length > 100)) throw new TypeError('Group name must contain 1–100 characters');
      if (patch.color !== undefined && (!Number.isInteger(patch.color) || patch.color < 0 || patch.color > 9)) throw new TypeError('Group color must be between 0 and 9');
      if (patch.repos !== undefined) {
        if (!Array.isArray(patch.repos) || patch.repos.length > MAX_GROUP_REPOS) throw new TypeError(`A group can contain at most ${MAX_GROUP_REPOS} repositories`);
        for (const path of patch.repos) assertAbsolutePath(path, 'repository path');
      }
      store.dispatch(groupChanged({ id: group.id, ...patch, ...(patch.name !== undefined && { name: patch.name.trim() }) }));
    },

    async 'repos:groupRemove'(_ctx, id) {
      const group = getGroup(id);
      const sync = store.getState().app.groupSync;
      if (sync?.groupId === group.id && !sync.done) throw new Error(t('Wait for the group update to finish or cancel it first'));
      store.dispatch(groupRemoved(group.id));
      if (sync?.groupId === group.id) store.dispatch(groupSyncChanged(null));
    },

    async 'repos:groupSync'(_ctx, id, mode) {
      if (mode !== 'fetch' && mode !== 'pull') throw new TypeError('mode must be fetch or pull');
      const group = getGroup(id);
      if (!group.repos.length) throw new Error(t('Add repositories to this group first'));
      await groupSync.run(group, mode);
    },

    async 'repos:groupCancel'() {
      groupSync.cancel();
    },

    async 'repos:groupDismiss'() {
      if (!store.getState().app.groupSync?.done) return;
      store.dispatch(groupSyncChanged(null));
    },

    async 'repos:groupStatus'(_ctx, id) {
      return readGroupStatus(getGroup(id), git, gitCli);
    },

    async 'file:openInEditor'(_ctx, repo, path, line) {
      const root = tab(repo);
      assertString(path, 'path');
      if (line !== undefined && (!Number.isInteger(line) || line < 1)) throw new TypeError('line must be a positive integer');
      await tools.openInEditor(await resolveInsideRepo(root, path), line, root, effective(root)['tools.editor']);
    },

    async 'file:history'(_ctx, repo, path, range) {
      const root = tab(repo);
      assertString(path, 'path');
      if (range) {
        assertSha(range.base);
        assertSha(range.head);
      }
      return fileHistory.log(root, normalizeRepoRelative(path), range);
    },

    async 'file:blame'(_ctx, repo, path, rev) {
      const root = tab(repo);
      assertString(path, 'path');
      if (rev !== null) assertSha(rev);
      return fileHistory.blame(root, normalizeRepoRelative(path), rev);
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

    async 'app:checkRelease'() {
      const result = await checkRelease();
      store.dispatch(releaseFound(result.status === 'available' ? result.release : null));
      return result;
    },

    async 'app:status'(_ctx, repo) {
      const root = optionalTab(repo);
      // Snapshot running commands before historySize potentially starts its own short read.
      const running = runningGitCommands(processes.running(), gitCli.executable);
      const [lastFetchTime, commits] = root ? await Promise.all([lastFetch(root), historySize(root)]) : [null, null];
      const memory = applicationMemory(app.getAppMetrics());
      return { memory, running, lastFetch: lastFetchTime, historySize: commits };
    },

    async 'process:cancel'(_ctx, id) {
      if (!Number.isInteger(id) || id < 1) throw new TypeError('id must be a positive integer');
      processes.cancel(id);
    },

    async 'terminal:create'({ sender }, repo, cols, rows) {
      const root = tab(repo);
      const size = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 && (value as number) < 2000 ? (value as number) : 80);
      return terminals.create(sender, root, {
        cwd: root,
        shell: settings.values['terminal.shell'],
        env: sanitizeEnv(await shellEnv()),
        cols: size(cols),
        rows: size(rows),
      });
    },

    async 'terminal:resize'({ sender }, id, cols, rows) {
      if (!Number.isInteger(id) || !Number.isInteger(cols) || !Number.isInteger(rows)) throw new TypeError('id and size must be integers');
      terminals.resize(sender, id, cols, rows);
    },

    async 'terminal:kill'({ sender }, id) {
      if (!Number.isInteger(id)) throw new TypeError('id must be an integer');
      terminals.kill(sender, id);
    },

    async 'settings:update'(_ctx, patch) {
      await settings.update(patch);
    },

    async 'settings:dismissProblems'() {
      store.dispatch(settingsProblemsDismissed());
    },

    async 'settings:browseExecutable'({ sender }) {
      return showOpenDialog(sender, { title: t('Choose program'), properties: ['openFile', 'dontAddToRecent'] });
    },

    async 'profile:apply'(_ctx, profileId, repo) {
      const profile = settings.values['profiles.list'].find((p) => p.id === profileId);
      if (!profile) throw new Error(t('There is no such profile'));
      const root = optionalTab(repo);
      await profiles.apply(profile, root);
      // The commit form shows who commits; read the repository again.
      const shown = root ?? store.getState().repos.view.activeId;
      if (shown) await store.dispatch(loadRepo(shown));
    },

    async 'profile:current'(_ctx, repo) {
      return profiles.current(optionalTab(repo), settings.values['profiles.list']);
    },

    async 'keys:list'() {
      return profiles.keys();
    },

    async 'keys:generateSsh'(_ctx, name, comment, passphrase) {
      return profiles.generateSshKey(name, comment, passphrase);
    },

    async 'keys:addToAgent'(_ctx, path) {
      await profiles.addToAgent(path);
    },

    async 'keys:publicKey'(_ctx, path) {
      return profiles.publicKey(path);
    },

    async 'commit:signature'(_ctx, repo, sha) {
      const root = tab(repo);
      assertSha(sha);
      return profiles.signature(root, sha);
    },

    async 'log:entries'(_ctx, afterId) {
      if (!Number.isInteger(afterId) || afterId < 0) throw new TypeError('afterId must be a non-negative integer');
      return log.page(afterId);
    },

    async 'log:operation'(_ctx, id) {
      if (!Number.isInteger(id) || id < 1) throw new TypeError('id must be a positive integer');
      return log.family(id);
    },

    async 'log:clear'() {
      log.clear();
    },

    async 'log:export'({ sender }) {
      const window = BrowserWindow.fromWebContents(sender);
      const options = { title: t('Save the operation log'), defaultPath: `forklift-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt` };
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      await writeFile(result.filePath, `${log.text()}\n`, { mode: 0o600 });
      return result.filePath;
    },

    async 'submodule:list'(_ctx, repo) {
      return submodules.list(tab(repo));
    },

    async 'submodule:add'(_ctx, repo, url, path) {
      const root = tab(repo);
      await thenRefresh(root, () => network(root, 'submodules', (run) => submodules.add(root, url, path, run)));
    },

    async 'submodule:update'(_ctx, repo, paths) {
      const root = tab(repo);
      const list = paths === null ? null : parsePaths(paths);
      await thenRefresh(root, () => network(root, 'submodules', (run) => submodules.update(root, list, true, run)));
    },

    async 'submodule:sync'(_ctx, repo) {
      const root = tab(repo);
      await thenRefresh(root, () => submodules.sync(root));
    },

    async 'submodule:remove'(_ctx, repo, path) {
      const root = tab(repo);
      assertString(path, 'path');
      await thenRefresh(root, () => submodules.remove(root, path));
    },

    async 'gitflow:config'(_ctx, repo) {
      return gitflow.config(tab(repo));
    },

    async 'gitflow:init'(_ctx, repo, config) {
      const root = tab(repo);
      await thenRefresh(root, () => gitflow.init(root, config));
    },

    async 'gitflow:start'(_ctx, repo, kind, name) {
      const root = tab(repo);
      if (kind !== 'feature' && kind !== 'release' && kind !== 'hotfix') throw new TypeError('kind must be feature, release or hotfix');
      return thenRefresh(root, () => gitflow.start(root, kind, name));
    },

    async 'gitflow:finish'(_ctx, repo, branch, options) {
      const root = tab(repo);
      const raw = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>;
      const { keepBranch, tagMessage } = raw;
      if (typeof keepBranch !== 'boolean') throw new TypeError('keepBranch must be a boolean');
      if (tagMessage !== undefined && (typeof tagMessage !== 'string' || tagMessage.length > 2000)) throw new TypeError('tagMessage must be text');
      await thenRefresh(root, () => gitflow.finish(root, branch, { keepBranch, ...(typeof tagMessage === 'string' && { tagMessage }) }));
    },

    async 'lfs:info'(_ctx, repo, paths) {
      return lfs.info(tab(repo), paths);
    },

    async 'lfs:track'(_ctx, repo, pattern) {
      const root = tab(repo);
      await thenRefresh(root, () => lfs.track(root, pattern));
    },

    async 'lfs:untrack'(_ctx, repo, pattern) {
      const root = tab(repo);
      await thenRefresh(root, () => lfs.untrack(root, pattern));
    },

    async 'lfs:download'(_ctx, repo, checkout) {
      const root = tab(repo);
      if (typeof checkout !== 'boolean') throw new TypeError('checkout must be a boolean');
      await thenRefresh(root, () => network(root, checkout ? 'pull' : 'fetch', (run) => lfs.download(root, checkout, run)));
    },

    async 'worktree:list'(_ctx, repo) {
      return worktrees.list(tab(repo));
    },

    async 'worktree:add'(_ctx, repo, request) {
      const root = tab(repo);
      const path = await thenRefresh(root, () => worktrees.add(root, request));
      return openRepository(store, git, path);
    },

    async 'worktree:remove'(_ctx, repo, path, force) {
      const root = tab(repo);
      if (typeof force !== 'boolean') throw new TypeError('force must be a boolean');
      await thenRefresh(root, () => worktrees.remove(root, path, force));
      // A tab of the removed tree has nothing to show any more.
      if (typeof path === 'string' && store.getState().repos.byId[path]) {
        store.dispatch(tabClosed(path));
        history.forget(path);
        terminals.closeRepo(path);
      }
    },

    async 'worktree:lock'(_ctx, repo, path, locked) {
      const root = tab(repo);
      if (typeof locked !== 'boolean') throw new TypeError('locked must be a boolean');
      // Read again so the window's list (keyed by the read) shows it.
      await thenRefresh(root, () => worktrees.lock(root, path, locked));
    },

    async 'worktree:prune'(_ctx, repo) {
      const root = tab(repo);
      await thenRefresh(root, () => worktrees.prune(root));
    },

    async 'avatars:get'(_ctx, emails) {
      return avatars.get(emails);
    },

    async 'themes:openFolder'() {
      const folder = store.getState().app.userThemes.folder;
      if (!folder) throw new Error(t('The themes folder is not available'));
      const failure = await shell.openPath(folder);
      if (failure) throw new Error(failure);
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
