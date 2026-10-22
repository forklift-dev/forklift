import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import type { RepoData, RepoState } from '../../shared/state';
import type { ThunkExtra } from './types';

const initialState: RepoState = {
  path: null,
  loading: false,
  error: null,
  data: null,
  pendingRequestId: null,
};

/** Opens (or re-reads) the repository containing `path`. */
export const loadRepo = createAsyncThunk<RepoData, string, { extra: ThunkExtra }>(
  'repo/load',
  async (path, { extra }) => {
    const root = await extra.git.resolveRoot(path);
    return extra.git.read(root);
  },
);

export const repoSlice = createSlice({
  name: 'repo',
  initialState,
  reducers: {
    repoClosed: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadRepo.pending, (state, action) => {
        state.loading = true;
        state.error = null;
        state.pendingRequestId = action.meta.requestId;
      })
      .addCase(loadRepo.fulfilled, (state, action) => {
        // A newer load superseded this one (e.g. the user picked another repo meanwhile).
        if (state.pendingRequestId !== action.meta.requestId) return;
        state.loading = false;
        state.pendingRequestId = null;
        state.path = action.payload.root;
        state.data = action.payload;
      })
      .addCase(loadRepo.rejected, (state, action) => {
        if (state.pendingRequestId !== action.meta.requestId) return;
        state.loading = false;
        state.pendingRequestId = null;
        state.error = action.error.message ?? 'Failed to open repository';
      });
  },
});

export const { repoClosed } = repoSlice.actions;
