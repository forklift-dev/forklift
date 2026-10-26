import { formatShortcut } from '../../../shared/keybindings';
import { fuzzyFilter } from '../../../shared/fuzzy';
import { t } from '../../../shared/i18n';
import { currentShortcuts, registeredCommands, useCommandsVersion } from '../commands';
import { useAppState } from '../state';
import { Palette, type PaletteItem } from './Palette';

/** Every command that can run now, filtered fuzzily; shows each one's shortcut. */
export function CommandPalette({ query, onQuery, onClose }: { query: string; onQuery(query: string): void; onClose(): void }) {
  // Re-rendered when commands come and go, or shortcuts change.
  useCommandsVersion();
  const platform = useAppState((s) => s.app.platform);
  useAppState((s) => s.settings.values['keys.bindings']);
  const shortcuts = currentShortcuts();
  const commands = registeredCommands()
    .filter((command) => !command.hidden && command.handler.enabled?.() !== false)
    .map((command) => ({ ...command, text: command.category ? `${command.category}: ${command.title}` : command.title, keys: shortcuts.get(command.id) ?? [] }))
    .sort((a, b) => a.text.localeCompare(b.text));
  const items: PaletteItem[] = fuzzyFilter(query, commands, (command) => command.text, 200).map(({ item, positions }) => ({
    key: item.id,
    label: item.text,
    positions,
    hint: item.keys[0] && formatShortcut(item.keys[0], platform),
    run: () => item.handler.run(),
  }));
  return <Palette label={t('Commands')} placeholder={t('Type a command')} query={query} onQuery={onQuery} items={items} empty={t('No matching commands')} onClose={onClose} />;
}
