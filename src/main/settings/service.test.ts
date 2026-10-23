import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitService } from '../git/service';
import { createAppStore } from '../store';
import { SettingsFile } from './file';
import { SettingsService } from './service';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forklift-settings-service-'));
  writeFileSync(join(dir, 'my-editor'), '#!/bin/sh\n', { mode: 0o755 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function setup() {
  const store = createAppStore({ version: '0', platform: 'linux' }, { git: {} as GitService });
  const file = new SettingsFile(join(dir, 'settings.json'));
  const service = new SettingsService({
    store,
    file,
    runner: { environment: async () => ({ PATH: dir }) },
    isOpenRepo: (root) => root === '/repo',
    themeExists: (id) => ['polar', 'user:mine'].includes(id),
  });
  await service.load();
  const saved = async () => {
    await file.save(store.getState().settings); // waits for queued writes
    return JSON.parse(readFileSync(file.path, 'utf8'));
  };
  return { store, service, saved };
}

describe('SettingsService', () => {
  it('applies valid changes, persists them and resets with null', async () => {
    const { service, saved } = await setup();
    await service.update({ values: { 'diff.layout': 'inline', 'editor.fontSize': 15 } });
    expect(service.values['diff.layout']).toBe('inline');
    expect((await saved()).settings).toEqual({ 'diff.layout': 'inline', 'editor.fontSize': 15 });
    await service.update({ values: { 'diff.layout': null } });
    expect(service.values['diff.layout']).toBe('split');
    expect((await saved()).settings).toEqual({ 'editor.fontSize': 15 });
  });

  it('keeps repository overrides separate and removes them with null', async () => {
    const { service, saved } = await setup();
    await service.update({ repo: '/repo', values: { 'tools.editor': { mode: 'preset', id: 'zed' } } });
    expect(service.effective('/repo')['tools.editor']).toEqual({ mode: 'preset', id: 'zed' });
    expect(service.effective('/other')['tools.editor']).toEqual({ mode: 'auto' });
    expect(service.effective(null)['tools.editor']).toEqual({ mode: 'auto' });
    expect((await saved()).repositories).toEqual({ '/repo': { 'tools.editor': { mode: 'preset', id: 'zed' } } });
    await service.update({ repo: '/repo', values: { 'tools.editor': null } });
    expect((await saved()).repositories).toEqual({});
  });

  it.each([
    [null, 'patch must be an object'],
    [{ values: {} }, '1 to 64 settings'],
    [{ values: { 'no.such': 1 } }, 'Unknown setting'],
    [{ values: { 'editor.fontSize': '15' } }, 'whole number'],
    [{ repo: '/repo', values: { 'diff.layout': 'inline' } }, 'cannot be set per repository'],
    [{ repo: '/elsewhere', values: { 'tools.editor': { mode: 'auto' } } }, 'open repository'],
    [{ values: { 'tools.editor': { mode: 'custom', command: 'missing-editor', args: [] } } }, 'was not found'],
    [{ values: { 'git.executable': 'relative/git' } }, 'full path'],
    [{ values: { 'git.executable': '/no/such/git' } }, 'was not found'],
    [{ values: { 'general.repositoriesFolder': 'projects' } }, 'full folder path'],
    [{ values: { 'ui.theme': 'user:gone' } }, 'There is no theme "user:gone"'],
    [{ values: { 'ui.theme': 'app' } }, 'There is no theme'],
    [{ values: { 'ui.editorTheme': 'system' } }, 'There is no theme'],
    [{ values: { 'ui.theme': '../x' } }, 'There is no theme'],
  ])('rejects %j', async (patch, message) => {
    const { service, store } = await setup();
    const before = store.getState().settings;
    await expect(service.update(patch)).rejects.toThrow(message);
    expect(store.getState().settings).toBe(before);
  });

  it('accepts existing themes and the special values', async () => {
    const { service, store } = await setup();
    await service.update({ values: { 'ui.theme': 'user:mine', 'ui.editorTheme': 'polar' } });
    expect(store.getState().settings.values).toMatchObject({ 'ui.theme': 'user:mine', 'ui.editorTheme': 'polar' });
    await service.update({ values: { 'ui.theme': 'system', 'ui.editorTheme': 'app' } });
    expect(store.getState().settings.values).toMatchObject({ 'ui.theme': 'system', 'ui.editorTheme': 'app' });
  });

  it('accepts programs that exist, by name in PATH or by full path', async () => {
    const { service } = await setup();
    await service.update({ values: { 'tools.editor': { mode: 'custom', command: 'my-editor', args: ['{file}'] } } });
    await service.update({ values: { 'tools.merge': { mode: 'custom', command: join(dir, 'my-editor'), args: ['$MERGED'], trustExitCode: false } } });
    await service.update({ values: { 'git.executable': join(dir, 'my-editor') } });
    expect(service.values['git.executable']).toBe(join(dir, 'my-editor'));
  });
});
