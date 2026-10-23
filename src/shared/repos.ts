/** A clone in progress (one at a time), shown on the Repositories screen. */
export interface CloneActivity {
  url: string;
  /** The folder being cloned into. */
  target: string;
  phase: string | null;
  percent: number | null;
}

export interface CloneRequest {
  url: string;
  /** Existing folder the repository's folder is created in. */
  parent: string;
  /** Name of the new folder. */
  name: string;
}

export interface InitRequest {
  parent: string;
  name: string;
  /** First branch name, e.g. "main". */
  branch: string;
  /** Keys of `.gitignore` templates to combine (none: no .gitignore). */
  gitignore: string[];
  /** License key, or null for none. */
  license: string | null;
  /** Copyright holder written into the license. */
  holder: string;
  initialCommit: boolean;
}

export interface TemplateOption {
  key: string;
  label: string;
}

/** What the Clone and Init dialogs start with. */
export interface CreateDefaults {
  parent: string;
  branch: string;
  holder: string;
  gitignore: TemplateOption[];
  licenses: TemplateOption[];
}

/** Folder name git would choose: "https://host/team/app.git" → "app", "git@host:app" → "app". */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '').replace(/[\\/]+$/, '');
  const last = trimmed.split(/[\\/:]/).filter(Boolean).pop() ?? '';
  return last.replace(/[\0<>:"|?*]/g, '').trim();
}

/** Why `name` can't be a new folder's name on any supported system, or null. */
export function folderNameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter a folder name';
  if (name.length > 255) return 'The folder name is too long';
  if (name === '.' || name === '..' || /[\\/\0<>:"|?*]/.test(name)) return `"${name}" is not a valid folder name`;
  if (/[. ]$/.test(name) || /^\s/.test(name)) return 'A folder name cannot start with a space or end with a space or a dot';
  return null;
}
