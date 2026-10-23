import { describe, expect, it } from 'vitest';
import { COMMANDS, defaultShortcuts, effectiveShortcuts, formatShortcut, normalizeShortcut, parseKeybindingOverrides, shortcutFromEvent, shortcutIndex } from './keybindings';

const press = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}, key = '') =>
  shortcutFromEvent({ code, key, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta });

describe('shortcuts', () => {
  it('reads key presses by physical key, any layout', () => {
    expect(press('KeyP', { ctrl: true, shift: true }, 'P')).toBe('Ctrl+Shift+P');
    // Cyrillic layout: the key labelled "З" is P.
    expect(press('KeyP', { ctrl: true }, 'з')).toBe('Ctrl+P');
    expect(press('Comma', { meta: true }, ',')).toBe('Meta+Comma');
    expect(press('Backquote', { ctrl: true }, '`')).toBe('Ctrl+Backquote');
    expect(press('ArrowUp', { alt: true })).toBe('Alt+Up');
    expect(press('Digit3', { ctrl: true, shift: true }, '#')).toBe('Ctrl+Shift+3');
    expect(press('F5')).toBe('F5');
    expect(press('ShiftLeft', { shift: true }, 'Shift')).toBeNull();
  });

  it('normalizes typed shortcuts', () => {
    expect(normalizeShortcut('shift+ctrl+p', 'linux')).toBe('Ctrl+Shift+P');
    expect(normalizeShortcut('Mod+,', 'darwin')).toBe('Meta+Comma');
    expect(normalizeShortcut('Mod+,', 'win32')).toBe('Ctrl+Comma');
    expect(normalizeShortcut('Cmd+Option+ArrowLeft', 'darwin')).toBe('Alt+Meta+Left');
    expect(normalizeShortcut('Ctrl+`', 'linux')).toBe('Ctrl+Backquote');
    expect(normalizeShortcut('ctrl+esc', 'linux')).toBe('Ctrl+Escape');
    expect(normalizeShortcut('Ctrl+Ctrl+P', 'linux')).toBeNull();
    expect(normalizeShortcut('Ctrl+Hyper', 'linux')).toBeNull();
    expect(normalizeShortcut('', 'linux')).toBeNull();
  });

  it('shows shortcuts the way each OS does', () => {
    expect(formatShortcut('Ctrl+Shift+P', 'linux')).toBe('Ctrl+Shift+P');
    expect(formatShortcut('Shift+Meta+P', 'darwin')).toBe('⇧⌘P');
    expect(formatShortcut('Ctrl+Backquote', 'darwin')).toBe('⌃`');
    expect(formatShortcut('Meta+Comma', 'win32')).toBe('Win+,');
  });
});

describe('defaults', () => {
  it.each(['linux', 'win32', 'darwin'] as const)('are valid and unique on %s', (platform) => {
    const all = COMMANDS.flatMap((command) => defaultShortcuts(command, platform));
    expect(all.every(Boolean)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it('use Cmd on macOS and Ctrl elsewhere', () => {
    const palette = COMMANDS.find((c) => c.id === 'palette.commands')!;
    expect(defaultShortcuts(palette, 'darwin')).toEqual(['Shift+Meta+P']);
    expect(defaultShortcuts(palette, 'linux')).toEqual(['Ctrl+Shift+P']);
    expect(defaultShortcuts(COMMANDS.find((c) => c.id === 'edit.redo')!, 'win32')).toEqual(['Ctrl+Shift+Z', 'Ctrl+Y']);
  });

  it('are replaced by overrides', () => {
    const shortcuts = effectiveShortcuts({ 'app.preferences': ['Ctrl+Alt+K'], 'tabs.close': [] }, 'linux');
    expect(shortcuts.get('app.preferences')).toEqual(['Ctrl+Alt+K']);
    expect(shortcuts.get('tabs.close')).toEqual([]);
    const index = shortcutIndex(shortcuts);
    expect(index.get('Ctrl+Alt+K')).toBe('app.preferences');
    expect(index.has('Ctrl+Comma')).toBe(false);
    expect(index.has('Ctrl+W')).toBe(false);
  });
});

describe('parseKeybindingOverrides', () => {
  it('accepts canonical shortcuts for known commands', () => {
    expect(parseKeybindingOverrides({ 'app.preferences': ['Ctrl+Alt+K', 'F2'], 'tabs.close': [] })).toEqual({ 'app.preferences': ['Ctrl+Alt+K', 'F2'], 'tabs.close': [] });
  });

  it.each([
    [[], /must be an object/],
    [{ 'no.such': [] }, /Unknown command/],
    [{ 'tabs.close': 'Ctrl+W' }, /must be a list/],
    [{ 'tabs.close': ['ctrl+w'] }, /is not a shortcut/],
    [{ 'tabs.close': ['Mod+W'] }, /is not a shortcut/],
    [{ 'tabs.close': ['Ctrl+W'], 'tabs.next': ['Ctrl+W'] }, /set for both/],
    [{ 'tabs.close': ['A', 'B', 'C', 'D', 'E'] }, /up to 4/],
  ])('rejects %j', (value, message) => {
    expect(() => parseKeybindingOverrides(value)).toThrow(message);
  });
});
