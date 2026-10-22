import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { LibraryState } from '../../shared/state';
import { repoName } from './reposSlice';

export const MAX_RECENT = 30;

const initialState: LibraryState = { recent: [], favorites: [] };

export const librarySlice = createSlice({
  name: 'library',
  initialState,
  reducers: {
    libraryLoaded: (_state, action: PayloadAction<LibraryState>) => action.payload,
    /** Moves the repository to the top of the recent list. */
    repoVisited: (state, action: PayloadAction<{ path: string; at: number }>) => {
      const { path, at } = action.payload;
      state.recent = [{ path, name: repoName(path), openedAt: at }, ...state.recent.filter((r) => r.path !== path)].slice(0, MAX_RECENT);
    },
    favoriteToggled: (state, action: PayloadAction<string>) => {
      const path = action.payload;
      state.favorites = state.favorites.includes(path) ? state.favorites.filter((p) => p !== path) : [...state.favorites, path];
    },
    /** Removes the repository from the recent list and favorites (the folder itself is untouched). */
    repoForgotten: (state, action: PayloadAction<string>) => {
      state.recent = state.recent.filter((r) => r.path !== action.payload);
      state.favorites = state.favorites.filter((p) => p !== action.payload);
    },
  },
});

export const { libraryLoaded, repoVisited, favoriteToggled, repoForgotten } = librarySlice.actions;
