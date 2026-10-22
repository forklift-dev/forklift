import { combineReducers, configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AppInfo, AppState } from '../../shared/state';
import { repoSlice } from './repoSlice';
import type { ThunkExtra } from './types';

const appSlice = createSlice({
  name: 'app',
  initialState: { version: '0.0.0', platform: 'unknown' } as AppInfo,
  reducers: {
    appInfoSet: (_state, action: PayloadAction<AppInfo>) => action.payload,
    gitVersionDetected: (state, action: PayloadAction<string | null>) => {
      state.gitVersion = action.payload;
    },
  },
});

export const { gitVersionDetected } = appSlice.actions;

const rootReducer = combineReducers({
  app: appSlice.reducer,
  repo: repoSlice.reducer,
});

// Fails to compile if the reducer tree drifts from the replicated AppState contract.
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const stateMatchesContract: AssertEqual<ReturnType<typeof rootReducer>, AppState> = true;
void stateMatchesContract;

export function createAppStore(appInfo: AppInfo, extra: ThunkExtra) {
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefault) => getDefault({ thunk: { extraArgument: extra } }),
  });
  store.dispatch(appSlice.actions.appInfoSet(appInfo));
  return store;
}

export type AppStore = ReturnType<typeof createAppStore>;
