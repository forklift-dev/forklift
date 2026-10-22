import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import type { AppStore } from '../store';
import { loadRepo, repoClosed } from '../store/repoSlice';
import type { CommandHandlers } from './registry';

// Arguments arrive from the renderer and are validated at runtime despite the typed contract.
function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
}

export function createCommandHandlers(store: AppStore): CommandHandlers {
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
  };
}
