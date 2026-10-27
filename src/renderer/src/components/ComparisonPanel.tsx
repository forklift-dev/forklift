import type { CommitFile, ComparisonMode, FileChangeStatus } from '../../../shared/diff';
import { t } from '../../../shared/i18n';
import { useCommand } from '../useCommand';

const STATUS: Record<FileChangeStatus, string> = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R', copied: 'C', typechange: 'T' };

interface ComparisonPanelProps {
  repo: string;
  left: string;
  right: string;
  mode: ComparisonMode;
  selectedPath: string | null;
  onMode(mode: ComparisonMode): void;
  onOpenFile(file: CommitFile, base: string): void;
  onFileHistory(file: CommitFile, base: string): void;
  onClose(): void;
}

export function ComparisonPanel({ repo, left, right, mode, selectedPath, onMode, onOpenFile, onFileHistory, onClose }: ComparisonPanelProps) {
  const { data, error } = useCommand('comparison:details', [repo, left, right, mode]);
  return (
    <div className="changes commit-details comparison-panel">
      <div className="commit-details-header">
        <strong>{t('Comparing revisions')}</strong>
        <button type="button" className="close-details" onClick={onClose} title={t('Close comparison')} aria-label={t('Close comparison')}>✕</button>
      </div>
      <div className="comparison-endpoints" title={`${left} → ${right}`}>
        <code>{left.slice(0, 10)}</code> <span aria-hidden="true">→</span> <code>{right.slice(0, 10)}</code>
      </div>
      <div className="comparison-modes" role="group" aria-label={t('Comparison mode')}>
        <button type="button" aria-pressed={mode === 'direct'} onClick={() => onMode('direct')}>A..B</button>
        <button type="button" aria-pressed={mode === 'merge-base'} onClick={() => onMode('merge-base')}>A...B</button>
      </div>
      <p className="comparison-note">{mode === 'direct' ? t('Changes from A to B') : t('Changes from their common ancestor to B')}</p>
      {error ? <p className="diff-message error">{error}</p> : !data ? <p className="empty-note">{t('Loading…')}</p> : (
        <div className="change-group">
          {mode === 'merge-base' && <p className="comparison-base">{t('Common ancestor: {sha}', { sha: data.base.slice(0, 10) })}</p>}
          <h3>{t('Files')} <span className="count">{data.files.length}</span></h3>
          {data.files.length === 0 ? <p className="empty-note">{t('No differences')}</p> : (
            <ul>{data.files.map((file) => (
              <li key={file.path} className="change-row">
                <button type="button" className={`change-item${selectedPath === file.path ? ' selected' : ''}`}
                  title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                  onClick={() => onOpenFile(file, data.base)}>
                  <span className={`kind kind-${file.status}`}>{STATUS[file.status]}</span>{file.path}
                </button>
                <button type="button" className="icon-button row-history" aria-label={t('History of {path}', { path: file.path })} title={t('File history between revisions')} onClick={() => onFileHistory(file, data.base)}>
                  <span className="codicon codicon-history" aria-hidden="true" />
                </button>
                {!data.statsOmitted && !file.binary && <span className="line-stats"><span className="kind-added">+{file.additions}</span> <span className="kind-deleted">−{file.deletions}</span></span>}
              </li>
            ))}</ul>
          )}
        </div>
      )}
    </div>
  );
}
