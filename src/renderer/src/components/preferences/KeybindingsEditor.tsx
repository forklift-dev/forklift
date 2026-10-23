import { useState, type KeyboardEvent } from 'react';
import { COMMANDS, defaultShortcuts, effectiveShortcuts, formatShortcut, keyPlatform, MAX_SHORTCUTS, shortcutFromEvent, type KeybindingOverrides } from '../../../../shared/keybindings';
import { useAppState } from '../../state';
import type { ControlProps } from './SettingRow';

const same = (a: string[], b: string[]) => a.length === b.length && a.every((key, i) => key === b[i]);

/** Every command with its shortcuts: add one by pressing it, remove one, or reset to the default. */
export function KeybindingsEditor({ id, value, save }: ControlProps) {
  const overrides = value as KeybindingOverrides;
  const platform = useAppState((s) => s.app.platform);
  const os = keyPlatform(platform);
  const [filter, setFilter] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ command: string; message: string } | null>(null);
  const shortcuts = effectiveShortcuts(overrides, os);
  const titleOf = (command: string) => COMMANDS.find((c) => c.id === command)?.title ?? command;
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = COMMANDS.filter((command) => {
    const haystack = `${command.category} ${command.title} ${(shortcuts.get(command.id) ?? []).map((key) => formatShortcut(key, platform)).join(' ')}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });

  const change = (command: string, keys: string[]) => {
    const next = { ...overrides };
    if (same(keys, defaultShortcuts(COMMANDS.find((c) => c.id === command)!, os))) delete next[command];
    else next[command] = keys;
    setProblem(null);
    void save(next);
  };

  const record = (command: string, event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) return setRecording(null);
    const shortcut = shortcutFromEvent(event);
    if (!shortcut) return; // a modifier on its own: wait for the key
    const key = shortcut.split('+').pop()!;
    if (!(event.ctrlKey || event.altKey || event.metaKey) && !/^F\d+$/.test(key)) {
      return setProblem({ command, message: `Use ${os === 'darwin' ? '⌘, ⌃ or ⌥' : 'Ctrl or Alt'} with the key (or an F key)` });
    }
    const owner = [...shortcuts].find(([, keys]) => keys.includes(shortcut))?.[0];
    setRecording(null);
    if (owner === command) return;
    if (owner) return setProblem({ command, message: `${formatShortcut(shortcut, platform)} is already used by “${titleOf(owner)}”. Remove it there first.` });
    change(command, [...(shortcuts.get(command) ?? []), shortcut]);
  };

  return (
    <div className="keybindings" id={id}>
      <input type="search" className="keybindings-filter" placeholder="Filter commands or shortcuts" aria-label="Filter shortcuts" value={filter} onChange={(event) => setFilter(event.target.value)} />
      <table className="keybindings-table">
        <tbody>
          {shown.map((command) => {
            const keys = shortcuts.get(command.id) ?? [];
            const changed = Object.hasOwn(overrides, command.id);
            return (
              <tr key={command.id} data-command={command.id} className={changed ? 'changed' : undefined}>
                <td className="keybinding-command">
                  <span className="keybinding-category">{command.category}:</span> {command.title}
                  {changed && <span className="keybinding-changed"> · changed</span>}
                  {problem?.command === command.id && (
                    <p className="setting-error" role="alert">
                      {problem.message}
                    </p>
                  )}
                </td>
                <td className="keybinding-keys">
                  {keys.map((key) => (
                    <span key={key} className="keybinding-chip">
                      <kbd>{formatShortcut(key, platform)}</kbd>
                      <button type="button" className="icon-button" aria-label={`Remove ${formatShortcut(key, platform)}`} onClick={() => change(command.id, keys.filter((k) => k !== key))}>
                        <span className="codicon codicon-close" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  {recording === command.id ? (
                    <button type="button" className="keybinding-recorder" data-key-recorder autoFocus onKeyDown={(event) => record(command.id, event)} onBlur={() => setRecording(null)}>
                      Press a shortcut… (Esc to cancel)
                    </button>
                  ) : (
                    keys.length < MAX_SHORTCUTS && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Add a shortcut for ${command.title}`}
                        title="Add a shortcut"
                        onClick={() => {
                          setProblem(null);
                          setRecording(command.id);
                        }}
                      >
                        <span className="codicon codicon-add" aria-hidden="true" />
                      </button>
                    )
                  )}
                </td>
                <td className="keybinding-reset">
                  {changed && (
                    <button type="button" className="link-button" onClick={() => change(command.id, defaultShortcuts(command, os))}>
                      Reset
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
