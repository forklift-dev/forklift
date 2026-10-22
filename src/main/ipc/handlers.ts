import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import type { DiffTools } from '../external/diffTools';
import type { ExternalTools } from '../external/tools';
import { normalizeRepoRelative, resolveInsideRepo } from '../repoPaths';
import type { AppStore } from '../store';
import { loadRepo, repoClosed } from '../store/repoSlice';
import type { CommandHandlers } from './registry';

export interface HandlerDeps {
  store: AppStore;
  tools: ExternalTools;
  diffTools: DiffTools;
}

// Arguments arrive from the renderer and are validated at runtime despite the typed contract.
function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
}

function openRepoRoot(store: AppStore): string {
  const { path } = store.getState().repo;
  if (!path) throw new Error('No repository is open');
  return path;
}

export function createCommandHandlers({ store, tools, diffTools }: HandlerDeps): CommandHandlers {
  return {
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
