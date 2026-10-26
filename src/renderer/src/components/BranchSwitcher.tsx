import { useState } from 'react';
import type { CheckoutTarget } from '../../../shared/branches';
import { fuzzyFilter } from '../../../shared/fuzzy';
import type { RepoData } from '../../../shared/state';
import { Palette, type PaletteItem } from './Palette';
import { t } from '../../../shared/i18n';

/** The branch ▾ of the toolbar: find a branch and check it out, or create one at HEAD. */
export function BranchSwitcher({ data, onClose, onCheckout, onCreate }: { data: RepoData; onClose(): void; onCheckout(target: CheckoutTarget): void; onCreate(): void }) {
  const [query, setQuery] = useState('');
  const branches = [
    ...data.branches.map((branch) => ({ kind: 'branch' as const, name: branch.name, remote: '', current: branch.current })),
    // A remote branch with a local one of the same name is reached through the local one.
    ...data.remoteBranches
      .filter((branch) => !branch.name.endsWith('/HEAD') && !data.branches.some((local) => `${branch.remote}/${local.name}` === branch.name))
      .map((branch) => ({ kind: 'remote' as const, name: branch.name, remote: branch.remote, current: false })),
  ];
  const items: PaletteItem[] = fuzzyFilter(query, branches, (branch) => branch.name, 200).map(({ item, positions }) => ({
    key: `${item.kind}:${item.name}`,
    group: item.kind === 'branch' ? t('Local') : t('Remote'),
    icon: item.current ? 'check' : item.kind === 'remote' ? 'cloud' : 'git-branch',
    label: item.name,
    positions,
    detail: item.current ? t('checked out') : undefined,
    run: () => {
      if (item.current) return;
      onCheckout(item.kind === 'branch' ? { kind: 'branch', name: item.name } : { kind: 'remote', name: item.name, remote: item.remote });
    },
  }));
  items.push({ key: 'create', icon: 'git-branch-create', label: t('Create a branch at HEAD…'), run: onCreate });
  return <Palette label={t('Branches')} placeholder={t('Switch to branch')} query={query} onQuery={setQuery} items={items} empty={t('No matching branches')} onClose={onClose} />;
}
