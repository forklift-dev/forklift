import { useEffect, useId, useRef, useState } from 'react';
import { folderNameProblem, repoNameFromUrl, type CreateDefaults } from '../../../shared/repos';
import { invoke } from '../api';
import { useAppState } from '../state';

export type NewRepoKind = 'clone' | 'init';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Clone a repository by URL, or create one with `git init`; the result opens in a tab. */
export function NewRepoDialog({ kind, onClose, onOpened }: { kind: NewRepoKind; onClose(): void; onOpened(): void }) {
  const id = useId();
  const [defaults, setDefaults] = useState<CreateDefaults | null>(null);
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  // The folder name follows the URL until it is edited.
  const [nameEdited, setNameEdited] = useState(false);
  const [branch, setBranch] = useState('main');
  const [gitignore, setGitignore] = useState<string[]>([]);
  const [license, setLicense] = useState('');
  const [holder, setHolder] = useState('');
  const [initialCommit, setInitialCommit] = useState(true);
  // The folder check's answer, for the inputs (and attempt) it was asked about.
  const [checked, setChecked] = useState<{ key: string; problem: string | null } | null>(null);
  // Bumped after a failed attempt, so the folder is checked again.
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clone = useAppState((s) => s.app.clone);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let current = true;
    void invoke('repo:createDefaults').then((loaded) => {
      if (!current) return;
      setDefaults(loaded);
      setParent(loaded.parent);
      setBranch(loaded.branch);
      setHolder(loaded.holder);
    });
    firstRef.current?.focus();
    return () => {
      current = false;
    };
  }, []);

  const folder = kind === 'clone' && !nameEdited ? repoNameFromUrl(url) : name;
  const checkKey = `${kind}\0${parent}\0${folder}\0${attempt}`;
  useEffect(() => {
    if (!parent || !folder || busy) return;
    let current = true;
    const timer = setTimeout(() => {
      const answer = (problem: string | null) => current && setChecked({ key: checkKey, problem });
      void invoke('repo:checkTarget', kind, parent, folder).then(answer, (failure: unknown) => answer(message(failure)));
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [kind, parent, folder, busy, checkKey]);

  const missing = !defaults ? '' : kind === 'clone' && !url.trim() ? 'Enter the repository URL' : !parent ? 'Choose a folder' : folderNameProblem(folder);
  // An empty string blocks without a message (still loading or checking).
  const blocker = missing ?? (checked?.key === checkKey ? checked.problem : '');
  const target = parent && folder ? `${parent.replace(/[\\/]+$/, '')}${parent.includes('\\') ? '\\' : '/'}${folder}` : '';

  const browse = async () => {
    const picked = await invoke('repo:pick', 'parent');
    if (picked) setParent(picked);
  };

  // While cloning, Cancel stops the clone and the dialog stays (to retry or close).
  const close = () => {
    if (busy && kind === 'clone') void invoke('repo:cancelClone');
    else if (!busy) onClose();
  };

  const submit = async () => {
    if (busy || blocker !== null) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'clone') await invoke('repo:clone', { url: url.trim(), parent, name: folder });
      else await invoke('repo:init', { parent, name: folder, branch: branch.trim(), gitignore, license: license || null, holder, initialCommit });
      onOpened();
    } catch (failure) {
      setBusy(false);
      setError(message(failure));
      setAttempt((n) => n + 1);
    }
  };

  const toggleTemplate = (key: string) => setGitignore((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <form
        className="modal form-dialog new-repo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        data-kind={kind}
        onMouseDown={(event) => event.stopPropagation()}
        onChange={() => setError(null)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 id={`${id}-title`}>{kind === 'clone' ? 'Clone a repository' : 'Create a repository'}</h2>
        <fieldset disabled={busy} className="new-repo-fields">
          {kind === 'clone' && (
            <label className="form-field">
              Repository URL
              <input ref={firstRef} type="text" name="url" value={url} spellCheck={false} placeholder="https://example.com/team/project.git or git@example.com:team/project.git" onChange={(event) => setUrl(event.target.value)} />
            </label>
          )}
          {kind === 'init' && (
            <label className="form-field">
              Name
              <input ref={firstRef} type="text" name="name" value={name} spellCheck={false} placeholder="my-project" onChange={(event) => setName(event.target.value)} />
            </label>
          )}
          <div className="form-field">
            <label htmlFor={`${id}-parent`}>{kind === 'clone' ? 'Clone into' : 'Create in'}</label>
            <span className="text-control">
              <input id={`${id}-parent`} type="text" name="parent" value={parent} spellCheck={false} onChange={(event) => setParent(event.target.value)} />
              <button type="button" onClick={() => void browse()}>
                Browse…
              </button>
            </span>
          </div>
          {kind === 'clone' && (
            <label className="form-field">
              Folder name
              <input
                type="text"
                name="name"
                value={folder}
                spellCheck={false}
                onChange={(event) => {
                  setNameEdited(true);
                  setName(event.target.value);
                }}
              />
            </label>
          )}
          {kind === 'init' && (
            <>
              <label className="form-field">
                Default branch
                <input type="text" name="branch" value={branch} spellCheck={false} onChange={(event) => setBranch(event.target.value)} />
              </label>
              <fieldset className="template-list">
                <legend>.gitignore</legend>
                {defaults?.gitignore.map((template) => (
                  <label key={template.key} className="checkbox-label">
                    <input type="checkbox" name={`gitignore-${template.key}`} checked={gitignore.includes(template.key)} onChange={() => toggleTemplate(template.key)} />
                    {template.label}
                  </label>
                ))}
              </fieldset>
              <label className="form-field">
                License
                <select name="license" value={license} onChange={(event) => setLicense(event.target.value)}>
                  <option value="">None</option>
                  {defaults?.licenses.map((template) => (
                    <option key={template.key} value={template.key}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
              {license && (
                <label className="form-field">
                  Copyright holder
                  <input type="text" name="holder" value={holder} spellCheck={false} placeholder="Your name or organization" onChange={(event) => setHolder(event.target.value)} />
                </label>
              )}
              <label className="checkbox-label">
                <input type="checkbox" name="initialCommit" checked={initialCommit} onChange={(event) => setInitialCommit(event.target.checked)} />
                Make the first commit
              </label>
            </>
          )}
        </fieldset>
        {target && <p className="new-repo-target">{target}</p>}
        {busy && kind === 'clone' && (
          <div className="clone-progress" role="status">
            <span>
              Cloning…{clone?.phase && ` ${clone.phase}`}
              {clone?.percent != null && ` ${clone.percent}%`}
            </span>
            <progress max={100} value={clone?.percent ?? undefined} />
          </div>
        )}
        {(error ?? (!busy && (url || name) ? blocker : null)) && (
          <p className="setting-error" role="alert">
            {error ?? blocker}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={close}>
            {busy && kind === 'clone' ? 'Cancel clone' : 'Cancel'}
          </button>
          <button type="submit" className="primary" disabled={busy || blocker !== null}>
            {kind === 'clone' ? 'Clone' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
