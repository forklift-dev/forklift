// Git LFS: pointer files, and what the app knows about LFS in a repository.

export interface LfsPointer {
  /** sha256 of the content. */
  oid: string;
  size: number;
}

/** "version https://git-lfs.github.com/spec/v1\noid sha256:…\nsize 123\n" → { oid, size }; null for anything else. */
export function parseLfsPointer(text: string | null): LfsPointer | null {
  if (!text || text.length > 1024 || !text.startsWith('version https://git-lfs.github.com/spec/v1')) return null;
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)?.[1];
  const size = /^size (\d+)$/m.exec(text)?.[1];
  return oid && size ? { oid, size: Number(size) } : null;
}

export interface LfsInfo {
  /** `git lfs version`, or null when git-lfs is not installed. */
  installed: string | null;
  /** Patterns in .gitattributes with filter=lfs. */
  patterns: string[];
  /** Of the paths asked about, those stored in LFS. */
  paths: string[];
}

/** The .gitattributes line `git lfs track` writes for a pattern (spaces escaped as git-lfs does). */
export const lfsAttributeLine = (pattern: string) => `${pattern.replace(/ /g, '[[:space:]]')} filter=lfs diff=lfs merge=lfs -text`;
