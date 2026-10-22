import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import type { DiffTarget } from '../../shared/diff';
import type { LineAction, LineActionRequest, LineChange } from '../../shared/staging';
import type { DiffTools } from '../external/diffTools';
import type { ExternalTools } from '../external/tools';
import type { GitService } from '../git/service';
import type { StagingService } from '../git/staging';
import { normalizeRepoRelative, resolveInsideRepo } from '../repoPaths';
import type { AppStore } from '../store';
import { loadRepo, repoClosed } from '../store/repoSlice';
import type { CommandHandlers } from './registry';

export interface HandlerDeps {
  store: AppStore;
  git: GitService;
  tools: ExternalTools;
  diffTools: DiffTools;
  staging: StagingService;
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

function openRepoRoot(store: AppStore): string {
  const { path } = store.getState().repo;
  if (!path) throw new Error('No repository is open');
  return path;
}

export function createCommandHandlers({ store, git, tools, diffTools, staging }: HandlerDeps): CommandHandlers {
  /** Runs an index/working-tree operation, then re-reads the repository whether or not it succeeded. */
  const thenRefresh = async <T>(root: string, operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } finally {
      if (store.getState().repo.path === root) await store.dispatch(loadRepo(root));
    }
  };

  return {
    async 'index:stage'(_ctx, paths) {
      const root = openRepoRoot(store);
      await thenRefresh(root, () => staging.stageFiles(root, parsePaths(paths)));
    },

    async 'index:unstage'(_ctx, paths) {
      const root = openRepoRoot(store);
      const unborn = store.getState().repo.data?.branch.oid == null;
      await thenRefresh(root, () => staging.unstageFiles(root, parsePaths(paths), unborn));
    },

    async 'index:discard'(_ctx, paths) {
      const root = openRepoRoot(store);
      const changes = new Map(store.getState().repo.data?.changes.map((change) => [change.path, change]));
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

    async 'index:applyLines'(_ctx, request) {
      const root = openRepoRoot(store);
      await thenRefresh(root, () => staging.applyLines(root, parseLineActionRequest(request)));
    },

    async 'commit:create'(_ctx, message, amend) {
      if (typeof message !== 'string' || message.trim() === '') throw new TypeError('Commit message is empty');
      if (typeof amend !== 'boolean') throw new TypeError('amend must be a boolean');
      const root = openRepoRoot(store);
      return thenRefresh(root, () => staging.commit(root, message, amend));
    },

    async 'commit:details'(_ctx, sha) {
      assertSha(sha);
      return git.commitDetails(openRepoRoot(store), sha);
    },

    async 'diff:file'(_ctx, target) {
      return git.fileDiff(openRepoRoot(store), parseDiffTarget(target));
    },

    async 'repo:pick'({ sender }) {
      const options: OpenDialogOptions = { title: 'Open repository', properties: ['openDirectory'] };
      const window = BrowserWindow.fromWebContents(sender);
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },

    async 'repo:open'(_ctx, path) {
      assertString(path, 'path');
      await store.dispatch(loadRepo(path)).unwrap();
    },

    async 'repo:refresh'() {
      const { path } = store.getState().repo;
      if (path) await store.dispatch(loadRepo(path)).unwrap();
    },

    async 'repo:close'() {
      store.dispatch(repoClosed());
    },

    async 'repo:openTerminal'() {
      await tools.openTerminal(openRepoRoot(store));
    },

    async 'file:openInEditor'(_ctx, path, line) {
      assertString(path, 'path');
      if (line !== undefined && (!Number.isInteger(line) || line < 1)) throw new TypeError('line must be a positive integer');
      const root = openRepoRoot(store);
      await tools.openInEditor(await resolveInsideRepo(root, path), line, root);
    },

    async 'file:externalDiff'(_ctx, path, staged) {
      assertString(path, 'path');
      if (typeof staged !== 'boolean') throw new TypeError('staged must be a boolean');
      await diffTools.diff(openRepoRoot(store), normalizeRepoRelative(path), staged);
    },

    async 'file:externalMerge'(_ctx, path) {
      assertString(path, 'path');
      const root = openRepoRoot(store);
      try {
        await diffTools.merge(root, normalizeRepoRelative(path));
      } finally {
        // Whether or not git accepted the resolution, the working tree and index changed.
        if (store.getState().repo.path === root) await store.dispatch(loadRepo(root));
      }
    },
  };
}
