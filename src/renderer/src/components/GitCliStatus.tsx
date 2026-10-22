import { useAppState } from '../state';

/** Which git CLI the app found, or why it may not work. */
export function GitCliStatus() {
  const info = useAppState((s) => s.app.gitCli);
  if (!info) return null;
  if (!info.version) return <small className="git-version warning">git CLI not found in PATH</small>;
  if (!info.meetsMinimum) {
    return (
      <small className="git-version warning">
        git {info.version} is older than {info.minimumVersion}; some operations may fail
      </small>
    );
  }
  return <small className="git-version">git {info.version}</small>;
}
