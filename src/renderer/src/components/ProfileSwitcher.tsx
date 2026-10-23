import { useState } from 'react';
import { fuzzyFilter } from '../../../shared/fuzzy';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { useAppState } from '../state';
import { useCommand } from '../useCommand';
import { Palette, type PaletteItem } from './Palette';

/** Picks a profile: Enter uses it for all repositories, Shift+Enter only for the open one. */
export function ProfileSwitcher({ repo, run, onClose, onEdit }: { repo: string | null; run: RunAction; onClose(): void; onEdit(): void }) {
  const profiles = useAppState((s) => s.settings.values['profiles.list']);
  const current = useCommand('profile:current', [repo]);
  const [query, setQuery] = useState('');
  const items: PaletteItem[] = fuzzyFilter(query, profiles, (profile) => profile.label).map(({ item: profile, positions }) => ({
    key: profile.id,
    icon: 'account',
    label: profile.label,
    positions,
    detail: `${profile.userName} <${profile.email}>${profile.signing !== 'none' ? ' · signs commits' : ''}`,
    hint: current.data?.current === profile.id ? 'in use' : undefined,
    run: ({ shift }) => void run(() => invoke('profile:apply', profile.id, shift && repo ? repo : null)),
  }));
  items.push({ key: 'edit', icon: 'settings-gear', label: 'Edit profiles…', run: onEdit });
  return (
    <Palette
      label="Profiles"
      placeholder="Switch profile"
      query={query}
      onQuery={setQuery}
      items={items}
      empty="No profiles"
      footer={
        <>
          <kbd>Enter</kbd> use for all repositories{repo && (<> · <kbd>Shift+Enter</kbd> only for this repository</>)}
        </>
      }
      onClose={onClose}
    />
  );
}
