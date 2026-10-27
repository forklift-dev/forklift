import { combineReducers, configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { EMPTY_REPO_STATE, type AppInfo, type GroupSync, type AppState, type AskPrompt, type GitCliInfo } from '../../shared/state';
import { librarySlice } from './librarySlice';
import { reposSlice } from './reposSlice';
import { settingsSlice } from './settingsSlice';
import type { CloneActivity } from '../../shared/repos';
import type { UserThemesState } from '../../shared/themes';
import type { ThunkExtra } from './types';

const appSlice = createSlice({
  name: 'app',
  initialState: { version: '0.0.0', platform: 'unknown', notices: [], prompts: [], clone: null, userThemes: { folder: '', themes: [], problems: [] }, logVersion: 0, secretStorage: false, groupSync: null } as AppInfo,
  reducers: {
    appInfoSet: (state, action: PayloadAction<Pick<AppInfo, 'version' | 'platform'>>) => ({ ...state, ...action.payload }),
    gitCliDetected: (state, action: PayloadAction<GitCliInfo>) => {
      state.gitCli = action.payload;
    },
    noticeAdded: (state, action: PayloadAction<string>) => {
      state.notices = [...state.notices.filter((notice) => notice !== action.payload), action.payload].slice(-10);
    },
    noticesDismissed: (state) => {
      state.notices = [];
    },
    promptAdded: (state, action: PayloadAction<AskPrompt>) => {
      state.prompts.push(action.payload);
    },
    promptRemoved: (state, action: PayloadAction<number>) => {
      state.prompts = state.prompts.filter((prompt) => prompt.id !== action.payload);
    },
    cloneActivity: (state, action: PayloadAction<CloneActivity | null>) => {
      state.clone = action.payload;
    },
    userThemesRead: (state, action: PayloadAction<UserThemesState>) => {
      state.userThemes = action.payload;
    },
    logChanged: (state) => {
      state.logVersion++;
    },
    secretStorageChecked: (state, action: PayloadAction<boolean>) => {
      state.secretStorage = action.payload;
    },
    groupSyncChanged: (state, action: PayloadAction<GroupSync | null>) => {
      state.groupSync = action.payload;
    },
  },
});

export const { cloneActivity, gitCliDetected, groupSyncChanged, logChanged, noticeAdded, noticesDismissed, promptAdded, promptRemoved, secretStorageChecked, userThemesRead } = appSlice.actions;

const rootReducer = combineReducers({
  app: appSlice.reducer,
  settings: settingsSlice.reducer,
  repos: reposSlice.reducer,
  library: librarySlice.reducer,
});

export type MainState = ReturnType<typeof rootReducer>;

/**
 * The window's view of the main state. Every slice it returns is an existing object of the main
 * state, so replication can detect changes by reference.
 */
export function projectState(state: MainState): AppState {
  const { activeId } = state.repos.view;
  return {
    app: state.app,
    settings: state.settings,
    tabs: state.repos.view,
    repo: (activeId && state.repos.byId[activeId]) || EMPTY_REPO_STATE,
    library: state.library,
  };
}

/**
 * `checks`: Redux Toolkit's development checks (state is serializable and never mutated). They walk the whole
 * state on every action, which a large repository makes slow; Toolkit picks its build by NODE_ENV, which is not
 * set in the packaged app's main process, so they are turned off explicitly there.
 */
export function createAppStore(appInfo: Pick<AppInfo, 'version' | 'platform'>, extra: ThunkExtra, { checks = true }: { checks?: boolean } = {}) {
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefault) => getDefault({ thunk: { extraArgument: extra }, serializableCheck: checks, immutableCheck: checks }),
    devTools: checks,
  });
  store.dispatch(appSlice.actions.appInfoSet(appInfo));
  return store;
}

export type AppStore = ReturnType<typeof createAppStore>;
