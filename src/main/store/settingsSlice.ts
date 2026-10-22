import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { defaultSettings, type SettingKey, type SettingsState, type SettingsValues } from '../../shared/settings';

const initialState: SettingsState = { values: defaultSettings(), repos: {}, problems: [] };

/** Validated changes: a value sets it, null resets it (global → default, repository → inherit). */
export interface SettingsChange {
  repo?: string;
  values: Partial<{ [K in SettingKey]: SettingsValues[K] | null }>;
}

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    settingsLoaded: (_state, action: PayloadAction<SettingsState>) => action.payload,
    settingsChanged: (state, action: PayloadAction<SettingsChange>) => {
      const { repo, values } = action.payload;
      const defaults = defaultSettings();
      if (repo === undefined) {
        for (const [key, value] of Object.entries(values) as [SettingKey, unknown][]) {
          (state.values as Record<SettingKey, unknown>)[key] = value ?? defaults[key];
        }
        return;
      }
      const overrides: Record<string, unknown> = { ...state.repos[repo] };
      for (const [key, value] of Object.entries(values)) {
        if (value === null) delete overrides[key];
        else overrides[key] = value;
      }
      if (Object.keys(overrides).length) state.repos[repo] = overrides;
      else delete state.repos[repo];
    },
    settingsProblemsDismissed: (state) => {
      state.problems = [];
    },
  },
});

export const { settingsLoaded, settingsChanged, settingsProblemsDismissed } = settingsSlice.actions;
