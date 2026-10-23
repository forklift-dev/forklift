import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { commandInfo, effectiveShortcuts, keyPlatform, shortcutFromEvent, shortcutIndex } from '../../shared/keybindings';
import { getState } from './state';

// The command registry: what each command does right now. Components register the commands they can run
// (the workspace its repository commands, the app its global ones); the palette lists what is registered
// and enabled, and one key listener runs commands by their shortcuts.

export interface CommandHandler {
  run(): void;
  /** False when the command can't run now (it is greyed out in the palette, and its shortcut passes through). */
  enabled?(): boolean;
  /** For commands not in the shared list (e.g. one per theme). */
  title?: string;
  category?: string;
}

export interface RegisteredCommand {
  id: string;
  title: string;
  category: string;
  hidden: boolean;
  handler: CommandHandler;
}

const handlers = new Map<string, CommandHandler>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  for (const listener of listeners) listener();
};

/**
 * Registers `commands` while the component is mounted. The latest handlers run, while the registration
 * itself changes only when the set of ids does (so the palette does not re-render on every render).
 */
export function useCommandHandlers(commands: Record<string, CommandHandler | null | undefined>): void {
  const latest = useRef(commands);
  useLayoutEffect(() => {
    latest.current = commands;
  });
  const ids = Object.keys(commands)
    .filter((id) => commands[id])
    .sort()
    .join('\n');
  useLayoutEffect(() => {
    const own = (ids ? ids.split('\n') : []).map((id): [string, CommandHandler] => [
      id,
      {
        run: () => latest.current[id]?.run(),
        enabled: () => {
          const handler = latest.current[id];
          return Boolean(handler) && handler!.enabled?.() !== false;
        },
        get title() {
          return latest.current[id]?.title;
        },
        get category() {
          return latest.current[id]?.category;
        },
      },
    ]);
    for (const [id, handler] of own) handlers.set(id, handler);
    changed();
    return () => {
      for (const [id, handler] of own) if (handlers.get(id) === handler) handlers.delete(id);
      changed();
    };
  }, [ids]);
}

export function registeredCommands(): RegisteredCommand[] {
  return [...handlers].map(([id, handler]) => {
    const info = commandInfo(id);
    return { id, title: handler.title ?? info?.title ?? id, category: handler.category ?? info?.category ?? '', hidden: info?.hidden ?? false, handler };
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Re-renders when commands are registered or removed. */
export function useCommandsVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** Runs a registered command; false when it isn't registered or can't run now. */
export function runCommand(id: string): boolean {
  const handler = handlers.get(id);
  if (!handler || handler.enabled?.() === false) return false;
  handler.run();
  return true;
}

/** Shortcuts as they are now (defaults for this OS with the user's changes). */
export function currentShortcuts(): Map<string, string[]> {
  const { settings, app } = getState();
  return effectiveShortcuts(settings.values['keys.bindings'], keyPlatform(app.platform));
}

let indexed: { overrides: unknown; index: Map<string, string> } | null = null;
function index(): Map<string, string> {
  const overrides = getState().settings.values['keys.bindings'];
  if (indexed?.overrides !== overrides) indexed = { overrides, index: shortcutIndex(currentShortcuts()) };
  return indexed.index;
}

/** Window event that opens the command palette with `detail` as its text (the finder's "> …"). */
export const OPEN_COMMANDS_EVENT = 'forklift:commands';

/** Where typing goes to the field rather than to app shortcuts that act on the content (undo, …). */
const isField = (target: EventTarget | null) => (target instanceof Element ? Boolean(target.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')) : false);

/**
 * Listens for shortcuts (capture phase: editors would otherwise keep Ctrl+Tab and friends). Keys without
 * Ctrl/Alt/Meta (other than F-keys) are left to whatever has the focus.
 */
export function startShortcuts(): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target;
    // A shortcut being recorded in Preferences.
    if (target instanceof Element && target.closest('[data-key-recorder]')) return;
    const shortcut = shortcutFromEvent(event);
    if (!shortcut) return;
    if (!(event.ctrlKey || event.altKey || event.metaKey) && !/^F\d+$/.test(shortcut.split('+').pop()!)) return;
    const id = index().get(shortcut);
    if (!id) return;
    if (commandInfo(id)?.notInFields && isField(target)) return;
    if (!runCommand(id)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}
