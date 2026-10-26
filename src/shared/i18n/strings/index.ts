// Every part's strings, merged. A part is a file here exporting `{ ru, en }`: `ru` translates each English
// message used in that part of the app; `en` holds only the English plural forms (a plural message's key is
// its `other` form).
import type { PluralForms } from '../index';
import { common } from './common';
import { toolbar } from './toolbar';
import { settings } from './settings';
import { commands } from './commands';
import { history } from './history';
import { workspace } from './workspace';
import { actions } from './actions';
import { diff } from './diff';
import { app } from './app';
import { hosting } from './hosting';
import { main } from './main';
import { status } from './status';

export const PARTS = {
  common,
  toolbar,
  settings,
  commands,
  history,
  workspace,
  actions,
  diff,
  app,
  hosting,
  main,
  status,
} as const;

export const RU = {
  ...common.ru,
  ...toolbar.ru,
  ...settings.ru,
  ...commands.ru,
  ...history.ru,
  ...workspace.ru,
  ...actions.ru,
  ...diff.ru,
  ...app.ru,
  ...hosting.ru,
  ...main.ru,
  ...status.ru,
};
export const EN: Readonly<Record<string, string | PluralForms>> = {
  ...common.en,
  ...toolbar.en,
  ...settings.en,
  ...commands.en,
  ...history.en,
  ...workspace.en,
  ...actions.en,
  ...diff.en,
  ...app.en,
  ...hosting.en,
  ...main.en,
  ...status.en,
};
