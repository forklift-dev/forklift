import { useEffect, useRef } from 'react';
import type { HistoryFilter, SearchField } from '../../../shared/history';
import { t } from '../../../shared/i18n';

const fields = (): Array<{ value: SearchField; label: string }> => [
  { value: 'message', label: t('Message') },
  { value: 'author', label: t('Author') },
  { value: 'sha', label: t('SHA') },
  { value: 'file', label: t('File name') },
  { value: 'content', label: t('Changed text') },
];

const shortRef = (ref: string) => ref.replace(/^refs\/(heads|remotes|tags)\//, '');

export interface SearchState {
  open: boolean;
  field: SearchField;
  text: string;
}

interface HistoryBarProps {
  filter: HistoryFilter;
  onShowAll(): void;
  onGoToHead(): void;
  search: SearchState;
  onSearch(search: SearchState): void;
  /** null while searching. */
  results: { count: number; truncated: boolean } | null;
  current: number;
  onStep(step: 1 | -1): void;
  error: string | null;
}

/** Above the graph: search (Ctrl+F) with result navigation, branch filter state, jump to HEAD. */
export function HistoryBar({ filter, onShowAll, onGoToHead, search, onSearch, results, current, onStep, error }: HistoryBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (search.open) inputRef.current?.focus();
  }, [search.open]);

  const filtered = filter.solo.length > 0 || filter.hidden.length > 0;
  return (
    <div className="history-bar">
      {search.open ? (
        <div className="history-search" role="search">
          <select aria-label={t('Search in')} value={search.field} onChange={(event) => onSearch({ ...search, field: event.target.value as SearchField })}>
            {fields().map((field) => (
              <option key={field.value} value={field.value}>
                {field.label}
              </option>
            ))}
          </select>
          <input
            ref={inputRef}
            type="search"
            aria-label={t('Search commits')}
            placeholder={t('Search commits')}
            value={search.text}
            onChange={(event) => onSearch({ ...search, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'ArrowDown') {
                event.preventDefault();
                onStep(event.shiftKey ? -1 : 1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                onStep(-1);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onSearch({ ...search, open: false, text: '' });
              }
            }}
          />
          <span className="search-count" role="status">
            {error ? <span className="setting-error">{error}</span> : !search.text.trim() ? '' : results === null ? t('Searching…') : results.count === 0 ? t('No matches') : t('{current} of {count}{truncated}', { current: current + 1, count: results.count, truncated: results.truncated ? '+' : '' })}
          </span>
          <button type="button" className="icon-button" aria-label={t('Previous match')} disabled={!results?.count} onClick={() => onStep(-1)}>
            <span className="codicon codicon-arrow-up" aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label={t('Next match')} disabled={!results?.count} onClick={() => onStep(1)}>
            <span className="codicon codicon-arrow-down" aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label={t('Close search')} onClick={() => onSearch({ ...search, open: false, text: '' })}>
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button type="button" className="icon-button" aria-label={t('Search commits')} title={t('Search commits (Ctrl+F)')} onClick={() => onSearch({ ...search, open: true })}>
          <span className="codicon codicon-search" aria-hidden="true" />
        </button>
      )}
      {filtered && (
        <span className="filter-status">
          {filter.solo.length ? t('Showing only {refs}', { refs: filter.solo.map(shortRef).join(', ') }) : t('{count} branches hidden', { count: filter.hidden.length })}
          <button type="button" className="link-button" onClick={onShowAll}>
            {t('Show all branches')}
          </button>
        </span>
      )}
      <button type="button" className="go-head" onClick={onGoToHead} title={t('Show the checked-out commit')}>
        {t('Go to HEAD')}
      </button>
    </div>
  );
}
