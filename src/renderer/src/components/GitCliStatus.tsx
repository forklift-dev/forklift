import { useAppState } from '../state';
import { t } from '../../../shared/i18n';

/** Which git CLI the app found, or why it may not work. */
export function GitCliStatus() {
  const info = useAppState((s) => s.app.gitCli);
  if (!info) return null;
  if (!info.version) return <small className="git-version warning">{t('git CLI not found in PATH')}</small>;
  if (!info.meetsMinimum) {
    return (
      <small className="git-version warning">
        {t('git {version} is older than {minimumVersion}; some operations may fail', { version: info.version, minimumVersion: info.minimumVersion })}
      </small>
    );
  }
  return <small className="git-version">git {info.version}</small>;
}
