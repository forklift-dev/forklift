import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { HookActivity } from '../../shared/hooks';
import { basename } from 'node:path';
import { EMPTY_REPO_STATE, type RemoteActivity, type RepoData, type RepoState, type TabInfo, type TabsState } from '../../shared/state';
import type { ThunkExtra } from './types';

/** Every open repository by tab id (its root), plus the tab bar the windows see. */
export interface ReposState {
  view: TabsState;
  byId: Record<string, RepoState>;
}

const initialState: ReposState = { view: { tabs: [], activeId: null }, byId: {} };

async function readTab(id: string, extra: ThunkExtra): Promise<RepoData> {
  const root = await extra.git.resolveRoot(id).catch(() => null);
  // A remembered repository that was moved or deleted (its folder may now sit inside another repository).
  if (root !== id) throw new Error(`No repository at ${id} any more`);
  return extra.git.read(root);
}

/** Reads the repository of tab `id` (its root), showing it as loading. */
export const loadRepo = createAsyncThunk<RepoData, string, { extra: ThunkExtra }>('repos/load', (id, { extra }) => readTab(id, extra));

/**
 * Re-reads a tab in the background (file watcher, window focus): no loading state, and a failure
 * keeps what is shown (a git command may hold the index for a moment); the next change retries.
 */
export const refreshRepo = createAsyncThunk<RepoData, string, { extra: ThunkExtra }>('repos/refresh', (id, { extra }) => readTab(id, extra));

export const repoName = (path: string) => basename(path) || path;

function updateTab(state: ReposState, id: string, change: Partial<TabInfo>) {
  const tab = state.view.tabs.find((t) => t.id === id);
  if (tab) Object.assign(tab, change);
}

export const reposSlice = createSlice({
  name: 'repos',
  initialState,
  reducers: {
    /** Adds a tab for `id` after the active one (or activates the existing tab). */
    tabOpened: (state, action: PayloadAction<{ id: string; activate?: boolean }>) => {
      const { id, activate = true } = action.payload;
      if (!state.byId[id]) {
        state.byId[id] = { ...EMPTY_REPO_STATE, path: id };
        const after = state.view.tabs.findIndex((t) => t.id === state.view.activeId);
        const tab: TabInfo = { id, name: repoName(id), loading: false, error: null };
        state.view.tabs.splice(after < 0 ? state.view.tabs.length : after + 1, 0, tab);
      }
      if (activate) state.view.activeId = id;
    },
    tabActivated: (state, action: PayloadAction<string>) => {
      if (state.byId[action.payload]) state.view.activeId = action.payload;
    },
    /** Closing the active tab activates its right neighbour, else the left one. */
    tabClosed: (state, action: PayloadAction<string>) => {
      const index = state.view.tabs.findIndex((t) => t.id === action.payload);
      if (index < 0) return;
      state.view.tabs.splice(index, 1);
      delete state.byId[action.payload];
      if (state.view.activeId === action.payload) {
        state.view.activeId = (state.view.tabs[index] ?? state.view.tabs[index - 1])?.id ?? null;
      }
    },
    remoteActivity: (state, action: PayloadAction<{ id: string; activity: RemoteActivity | null }>) => {
      const repo = state.byId[action.payload.id];
      if (repo) repo.remote = action.payload.activity;
    },
    hookActivity: (state, action: PayloadAction<{ id: string; activity: HookActivity | null }>) => {
      const repo = state.byId[action.payload.id];
      if (repo) repo.hooks = action.payload.activity;
    },
    undoChanged: (state, action: PayloadAction<{ id: string; undo: string | null; redo: string | null }>) => {
      const repo = state.byId[action.payload.id];
      if (repo) repo.undo = { undo: action.payload.undo, redo: action.payload.redo };
    },
    tabMoved: (state, action: PayloadAction<{ id: string; index: number }>) => {
      const from = state.view.tabs.findIndex((t) => t.id === action.payload.id);
      if (from < 0) return;
      const [tab] = state.view.tabs.splice(from, 1);
      const to = Math.max(0, Math.min(action.payload.index, state.view.tabs.length));
      state.view.tabs.splice(to, 0, tab!);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadRepo.pending, (state, action) => {
        const repo = state.byId[action.meta.arg];
        if (!repo) return;
        repo.loading = true;
        repo.error = null;
        repo.pendingRequestId = action.meta.requestId;
        updateTab(state, action.meta.arg, { loading: true, error: null });
      })
      .addCase(loadRepo.fulfilled, (state, action) => {
        const repo = state.byId[action.meta.arg];
        // The tab was closed, or a newer load superseded this one.
        if (!repo || repo.pendingRequestId !== action.meta.requestId) return;
        repo.loading = false;
        repo.pendingRequestId = null;
        repo.data = action.payload;
        updateTab(state, action.meta.arg, { loading: false, error: null });
      })
      .addCase(refreshRepo.fulfilled, (state, action) => {
        const repo = state.byId[action.meta.arg];
        // A load in progress wins; a closed tab or one never read stays as it is.
        if (!repo || repo.pendingRequestId !== null || !repo.data) return;
        repo.data = action.payload;
        repo.error = null;
        updateTab(state, action.meta.arg, { error: null });
      })
      .addCase(loadRepo.rejected, (state, action) => {
        const repo = state.byId[action.meta.arg];
        if (!repo || repo.pendingRequestId !== action.meta.requestId) return;
        repo.loading = false;
        repo.pendingRequestId = null;
        repo.error = action.error.message ?? 'Failed to read the repository';
        updateTab(state, action.meta.arg, { loading: false, error: repo.error });
      });
  },
});

export const { tabOpened, tabActivated, tabClosed, tabMoved, remoteActivity, hookActivity, undoChanged } = reposSlice.actions;
