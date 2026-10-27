import { useEffect, useRef, useState } from 'react';
import { fuzzyFilter } from '../../../shared/fuzzy';
import { t } from '../../../shared/i18n';
import type { RepoData } from '../../../shared/state';

interface UpstreamPickerProps {
  data: RepoData;
  branch: string;
  onPick(upstream: string | null): void;
  onClose(): void;
}

/** A local branch tracks one known remote branch. Selection is previewed before it is applied. */
export function UpstreamPicker({ data, branch, onPick, onClose }: UpstreamPickerProps) {
  const current = data.branches.find((candidate) => candidate.name === branch)?.upstream ?? null;
  const remotes = data.remoteBranches
    .filter((candidate) => !candidate.name.endsWith('/HEAD'))
    .sort((a, b) => {
      const aSuggested = a.name === `${a.remote}/${branch}`;
      const bSuggested = b.name === `${b.remote}/${branch}`;
      return Number(bSuggested) - Number(aSuggested) || a.remote.localeCompare(b.remote) || a.name.localeCompare(b.name);
    });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(current ?? remotes[0]?.name ?? null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = fuzzyFilter(query, remotes, (candidate) => candidate.name, 300).map(({ item }) => item);
  const highlighted = Math.min(active, Math.max(0, filtered.length - 1));

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  });

  const choose = (upstream: string | null) => {
    if (upstream !== current) onPick(upstream);
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <div className="modal upstream-picker" role="dialog" aria-modal="true" aria-label={t('Upstream of {branch}', { branch })} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === 'Escape') onClose();
      else if (event.target === inputRef.current && event.key === 'ArrowDown') setActive((highlighted + 1) % Math.max(1, filtered.length));
      else if (event.target === inputRef.current && event.key === 'ArrowUp') setActive((highlighted - 1 + filtered.length) % Math.max(1, filtered.length));
      else if (event.target === inputRef.current && event.key === 'Enter' && filtered[highlighted]) choose(filtered[highlighted]!.name);
      else return;
      event.preventDefault();
      event.stopPropagation();
    }}>
      <h2>{t('Upstream of {branch}', { branch })}</h2>
      <p className="upstream-current">{t('Currently tracking: {upstream}', { upstream: current ?? t('No upstream') })}</p>
      <input ref={inputRef} type="search" aria-label={t('Search remote branches')} placeholder={t('Search remote branches')} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} />
      <div className="upstream-options" role="radiogroup" aria-label={t('Remote branches')} ref={listRef}>
        {filtered.map((candidate, index) => {
          const suggested = candidate.name === `${candidate.remote}/${branch}`;
          const group = suggested ? t('Suggested') : candidate.remote;
          const previous = filtered[index - 1];
          const previousGroup = previous && (previous.name === `${previous.remote}/${branch}` ? t('Suggested') : previous.remote);
          return <div key={candidate.name}>
            {group !== previousGroup && <div className="upstream-group">{group}</div>}
            <button type="button" role="radio" aria-checked={selected === candidate.name} data-active={highlighted === index} className="upstream-option" onMouseMove={() => setActive(index)} onClick={() => setSelected(candidate.name)} onDoubleClick={() => choose(candidate.name)}>
              <span className={`codicon ${selected === candidate.name ? 'codicon-check' : 'codicon-circle-outline'}`} aria-hidden="true" />
              <span className="upstream-option-name"><strong>{candidate.name.slice(candidate.remote.length + 1)}</strong><small>{candidate.remote}</small></span>
              {candidate.name === current && <span className="upstream-badge">{t('current upstream')}</span>}
            </button>
          </div>;
        })}
        {!filtered.length && <p className="upstream-empty">{remotes.length ? t('No matching remote branches') : t('No remote branches: push the branch to a remote first (it is tracked from then on)')}</p>}
      </div>
      <div className="upstream-footer">
        {current && <button type="button" className="danger-text" onClick={() => choose(null)}>{t('Stop tracking {upstream}', { upstream: current })}</button>}
        <span className="upstream-footer-spacer" />
        <button type="button" onClick={onClose}>{t('Cancel')}</button>
        <button type="button" className="primary" disabled={!selected || selected === current} onClick={() => choose(selected)}>{t('Set upstream')}</button>
      </div>
    </div>
  </div>;
}
