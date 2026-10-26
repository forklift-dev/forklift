import { useState } from 'react';
import { fuzzyFilter } from '../../../shared/fuzzy';
import { t } from '../../../shared/i18n';
import { invoke } from '../api';
import type { RunAction } from '../App';
import { useAppState } from '../state';
import { useCommand } from '../useCommand';
import { tx } from '../i18n';
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
    detail:
      profile.signing !== 'none'
        ? t('{identity} · signs commits', { identity: `${profile.userName} <${profile.email}>` })
        : `${profile.userName} <${profile.email}>`,
    hint: current.data?.current === profile.id ? t('in use') : undefined,
    run: ({ shift }) => void run(() => invoke('profile:apply', profile.id, shift && repo ? repo : null)),
  }));
  items.push({ key: 'edit', icon: 'settings-gear', label: t('Edit profiles…'), run: onEdit });
  return (
    <Palette
      label={t('Profiles')}
      placeholder={t('Switch profile')}
      query={query}
      onQuery={setQuery}
      items={items}
      empty={t('No profiles')}
      footer={
        <>
          {repo
            ? tx('{enter} use for all repositories · {shiftEnter} only for this repository', { enter: <kbd>Enter</kbd>, shiftEnter: <kbd>Shift+Enter</kbd> })
            : tx('{enter} use for all repositories', { enter: <kbd>Enter</kbd> })}
        </>
      }
      onClose={onClose}
    />
  );
}
