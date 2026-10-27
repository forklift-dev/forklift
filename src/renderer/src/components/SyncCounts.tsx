import { t } from '../../../shared/i18n';

interface SyncCountsProps {
  ahead: number;
  behind: number;
  upstream: string;
}

/** Commit counts stay legible beside a long branch name and across light and dark themes. */
export function SyncCounts({ ahead, behind, upstream }: SyncCountsProps) {
  if (ahead <= 0 && behind <= 0) return null;
  return <span className="sync-counts" role="img" title={t('{ahead} ahead, {behind} behind {upstream}', { ahead, behind, upstream })} aria-label={t('{ahead} ahead, {behind} behind {upstream}', { ahead, behind, upstream })}>
    {ahead > 0 && <span className="sync-count sync-count-ahead"><span className="codicon codicon-arrow-up" aria-hidden="true" /><strong>{ahead}</strong></span>}
    {behind > 0 && <span className="sync-count sync-count-behind"><span className="codicon codicon-arrow-down" aria-hidden="true" /><strong>{behind}</strong></span>}
  </span>;
}
