import { combineReducers, configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { EMPTY_REPO_STATE, type AppInfo, type AppState, type GitCliInfo } from '../../shared/state';
import { librarySlice } from './librarySlice';
import { reposSlice } from './reposSlice';
import { settingsSlice } from './settingsSlice';
import type { ThunkExtra } from './types';

const appSlice = createSlice({
  name: 'app',
  initialState: { version: '0.0.0', platform: 'unknown', notices: [] } as AppInfo,
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
  },
});

export const { gitCliDetected, noticeAdded, noticesDismissed } = appSlice.actions;

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

export function createAppStore(appInfo: Pick<AppInfo, 'version' | 'platform'>, extra: ThunkExtra) {
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefault) => getDefault({ thunk: { extraArgument: extra } }),
  });
  store.dispatch(appSlice.actions.appInfoSet(appInfo));
  return store;
}

export type AppStore = ReturnType<typeof createAppStore>;
