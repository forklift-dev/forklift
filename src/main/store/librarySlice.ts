import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { MAX_GROUP_REPOS, MAX_GROUPS, type LibraryState, type RepoGroup } from '../../shared/state';
import { repoName } from './reposSlice';

export const MAX_RECENT = 30;

const initialState: LibraryState = { recent: [], favorites: [], groups: [] };

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
    groupCreated: (state, action: PayloadAction<RepoGroup>) => {
      if (state.groups.length < MAX_GROUPS) state.groups.push({ ...action.payload, repos: [...new Set(action.payload.repos)].slice(0, MAX_GROUP_REPOS) });
    },
    groupChanged: (state, action: PayloadAction<{ id: string } & Partial<Pick<RepoGroup, 'name' | 'color' | 'repos'>>>) => {
      const group = state.groups.find((candidate) => candidate.id === action.payload.id);
      if (!group) return;
      if (action.payload.name !== undefined) group.name = action.payload.name;
      if (action.payload.color !== undefined) group.color = action.payload.color;
      if (action.payload.repos !== undefined) group.repos = [...new Set(action.payload.repos)].slice(0, MAX_GROUP_REPOS);
    },
    groupRemoved: (state, action: PayloadAction<string>) => {
      state.groups = state.groups.filter((group) => group.id !== action.payload);
    },
    /** Removes the repository from the recent list and favorites (the folder itself is untouched). */
    repoForgotten: (state, action: PayloadAction<string>) => {
      state.recent = state.recent.filter((r) => r.path !== action.payload);
      state.favorites = state.favorites.filter((p) => p !== action.payload);
    },
  },
});

export const { libraryLoaded, repoVisited, favoriteToggled, repoForgotten, groupCreated, groupChanged, groupRemoved } = librarySlice.actions;
