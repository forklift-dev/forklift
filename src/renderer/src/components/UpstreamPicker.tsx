import { useState } from 'react';
import { fuzzyFilter } from '../../../shared/fuzzy';
import type { RepoData } from '../../../shared/state';
import { Palette, type PaletteItem } from './Palette';

interface UpstreamPickerProps {
  data: RepoData;
  branch: string;
  onPick(upstream: string | null): void;
  onClose(): void;
}

/** Which remote branch a local branch tracks: the remote branches (same name first), or none. */
export function UpstreamPicker({ data, branch, onPick, onClose }: UpstreamPickerProps) {
  const [query, setQuery] = useState('');
  const current = data.branches.find((candidate) => candidate.name === branch)?.upstream ?? null;
  const remote = data.remoteBranches
    .filter((candidate) => !candidate.name.endsWith('/HEAD'))
    // Most likely first: the branch's own name on each remote.
    .sort((a, b) => Number(b.name === `${b.remote}/${branch}`) - Number(a.name === `${a.remote}/${branch}`) || a.name.localeCompare(b.name));
  const items: PaletteItem[] = fuzzyFilter(query, remote, (candidate) => candidate.name, 300).map(({ item, positions }) => ({
    key: item.name,
    group: item.remote,
    icon: item.name === current ? 'check' : 'cloud',
    label: item.name,
    positions,
    detail: item.name === current ? 'current upstream' : undefined,
    run: () => item.name !== current && onPick(item.name),
  }));
  if (current) items.push({ key: 'none', icon: 'debug-disconnect', label: `Stop tracking ${current}`, run: () => onPick(null) });
  return (
    <Palette
      label={`Upstream of ${branch}`}
      placeholder={`Remote branch for ${branch} to track`}
      query={query}
      onQuery={setQuery}
      items={items}
      empty={remote.length ? 'No matching remote branches' : 'No remote branches: push the branch to a remote first (it is tracked from then on)'}
      onClose={onClose}
    />
  );
}
