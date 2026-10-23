import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Diff, Repository, type Blob, type Commit, type IndexEntry, type Tree } from '@axosoft/nodegit';
import {
  MAX_DIFF_FILE_BYTES,
  type CommitDetails,
  type CommitFile,
  type DiffTarget,
  type FileChangeStatus,
  type FileDiff,
  type FileVersion,
  type Signature,
} from '../../shared/diff';
import { DELTA, DIFF_FIND_RENAMES, DIFF_FLAG_BINARY, STATUS_OPT } from './libgit2';

/** Above this many changed files line counts are skipped: computing them needs every patch. */
const STATS_FILE_LIMIT = 2000;
/** git's own heuristic: a NUL byte in the first 8000 bytes means binary. */
const BINARY_SNIFF_BYTES = 8000;

const STATUS_BY_DELTA: Record<number, FileChangeStatus> = {
  [DELTA.ADDED]: 'added',
  [DELTA.DELETED]: 'deleted',
  [DELTA.MODIFIED]: 'modified',
  [DELTA.RENAMED]: 'renamed',
  [DELTA.COPIED]: 'copied',
  [DELTA.TYPECHANGE]: 'typechange',
};

function signature(sig: ReturnType<Commit['author']>): Signature {
  return { name: sig.name(), email: sig.email(), time: sig.when().time() };
}

async function firstParentTree(commit: Commit): Promise<Tree | undefined> {
  return commit.parentcount() > 0 ? (await commit.parent(0)).getTree() : undefined;
}

export async function readCommitDetails(repo: Repository, sha: string): Promise<CommitDetails> {
  const commit = await repo.getCommit(sha);
  // Merge commits are shown against their first parent, like `git show --first-parent`.
  const diff = await Diff.treeToTree(repo, await firstParentTree(commit), await commit.getTree());
  await diff.findSimilar({ flags: DIFF_FIND_RENAMES });

  const count = diff.numDeltas();
  const statsOmitted = count > STATS_FILE_LIMIT;
  // Patches compute line counts and settle the binary flag of each delta (same order as deltas).
  const patches = statsOmitted ? [] : await diff.patches();

  const files: CommitFile[] = [];
  for (let i = 0; i < count; i++) {
    const delta = diff.getDelta(i);
    const status = STATUS_BY_DELTA[delta.status()];
    if (!status) continue;
    const path = delta.newFile().path();
    const oldPath = delta.oldFile().path();
    const stats = patches[i]?.lineStats() as { total_additions: number; total_deletions: number } | undefined;
    files.push({
      path,
      ...((status === 'renamed' || status === 'copied') && oldPath !== path && { oldPath }),
      status,
      additions: stats?.total_additions ?? 0,
      deletions: stats?.total_deletions ?? 0,
      binary: (delta.flags() & DIFF_FLAG_BINARY) !== 0,
    });
  }

  return {
    hash: commit.sha(),
    parents: commit.parents().map((oid) => oid.tostrS()),
    author: signature(commit.author()),
    committer: signature(commit.committer()),
    message: commit.message(),
    files,
    statsOmitted,
  };
}

/**
 * A stash commit's tree is the stashed working tree (its parents: the base, the index, the untracked files).
 * Shown like a commit against the base, plus the untracked files of the third parent as added files.
 */
export async function readStashDetails(repo: Repository, sha: string): Promise<CommitDetails> {
  const details = await readCommitDetails(repo, sha);
  const commit = await repo.getCommit(sha);
  if (commit.parentcount() < 3) return details;
  const untracked = await commit.parent(2);
  const extra = await readCommitDetails(repo, untracked.sha());
  const known = new Set(details.files.map((file) => file.path));
  for (const file of extra.files) {
    if (!known.has(file.path)) details.files.push({ ...file, status: 'added', sourceSha: untracked.sha() });
  }
  details.files.sort((a, b) => a.path.localeCompare(b.path));
  return details;
}

const missing = (path: string): FileVersion => ({
  path,
  exists: false,
  binary: false,
  tooLarge: false,
  size: 0,
  text: null,
  lossy: false,
  hash: null,
});

const tooLarge = (path: string, size: number): FileVersion => ({ ...missing(path), exists: true, tooLarge: true, size });

// ignoreBOM keeps a byte-order mark in the text, so writing the text back reproduces it.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const lenientUtf8 = new TextDecoder('utf-8', { ignoreBOM: true });

function decode(bytes: Buffer): { text: string; lossy: boolean } {
  try {
    return { text: strictUtf8.decode(bytes), lossy: false };
  } catch {
    // Shown with replacement characters; partial staging refuses such text (it cannot be written back).
    return { text: lenientUtf8.decode(bytes), lossy: true };
  }
}

function fromBytes(path: string, bytes: Buffer, binary: boolean): FileVersion {
  if (binary) return { ...missing(path), exists: true, binary: true, size: bytes.length };
  const { text, lossy } = decode(bytes);
  return {
    path,
    exists: true,
    binary: false,
    tooLarge: false,
    size: bytes.length,
    text,
    lossy,
    hash: createHash('sha256').update(text).digest('hex'),
  };
}

function fromBlob(path: string, blob: Blob): FileVersion {
  const size = blob.rawsize();
  if (size > MAX_DIFF_FILE_BYTES) return tooLarge(path, size);
  return fromBytes(path, blob.content(), blob.isBinary() !== 0);
}

async function fromTree(repo: Repository, tree: Tree | undefined, path: string): Promise<FileVersion> {
  if (!tree) return missing(path);
  const entry = await tree.getEntry(path).catch(() => null);
  if (!entry) return missing(path);
  if (entry.isSubmodule()) return fromBytes(path, Buffer.from(`Subproject commit ${entry.sha()}\n`), false);
  return fromBlob(path, await repo.getBlob(entry.id()));
}

/** A file in the index; stage 0 is the normal entry (absent while conflicted), 1–3 are base/ours/theirs of a conflict. */
export async function fromIndex(repo: Repository, path: string, stage: 0 | 1 | 2 | 3 = 0): Promise<FileVersion> {
  const index = await repo.refreshIndex();
  let entry: IndexEntry | undefined;
  if (stage === 0) {
    entry = index.getByPath(path, 0);
  } else {
    // The binding's getByPath ignores the stage argument; conflictGet returns all three stages.
    const conflict = (await index.conflictGet(path).catch(() => null)) as unknown as Record<string, IndexEntry | undefined> | null;
    const key = stage === 1 ? 'ancestor_out' : stage === 2 ? 'our_out' : 'their_out';
    entry = conflict?.[key];
  }
  if (!entry) return missing(path);
  // A submodule is recorded as the commit it points at, shown as git shows it.
  if (entry.mode === 0o160000) return fromBytes(path, Buffer.from(`Subproject commit ${entry.id.tostrS()}\n`), false);
  return fromBlob(path, await repo.getBlob(entry.id));
}

export async function fromWorkingTree(root: string, path: string): Promise<FileVersion> {
  const fullPath = join(root, path);
  const stats = await lstat(fullPath).catch(() => null);
  if (!stats) return missing(path);
  // git stores a symlink as its target path, so compare that rather than the file it points to.
  if (stats.isSymbolicLink()) return fromBytes(path, Buffer.from(await readlink(fullPath)), false);
  if (stats.isDirectory()) return fromSubmodule(fullPath, path);
  if (stats.size > MAX_DIFF_FILE_BYTES) return tooLarge(path, stats.size);
  const bytes = await readFile(fullPath);
  return fromBytes(path, bytes, bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0));
}

/** A submodule's working tree: its checked-out commit, "-dirty" with changes inside (like `git diff`). */
async function fromSubmodule(fullPath: string, path: string): Promise<FileVersion> {
  const sub = await Repository.open(fullPath).catch(() => null);
  if (!sub) return missing(path);
  try {
    if (sub.headUnborn()) return missing(path);
    const head = (await sub.getHeadCommit()).sha();
    const dirty = (await sub.getStatus({ flags: STATUS_OPT.INCLUDE_UNTRACKED })).length > 0;
    return fromBytes(path, Buffer.from(`Subproject commit ${head}${dirty ? '-dirty' : ''}\n`), false);
  } finally {
    sub.cleanup();
  }
}

async function headTree(repo: Repository): Promise<Tree | undefined> {
  if (repo.headUnborn()) return undefined;
  return (await repo.getHeadCommit()).getTree();
}

export async function readFileDiff(repo: Repository, root: string, target: DiffTarget): Promise<FileDiff> {
  const originalPath = target.oldPath ?? target.path;
  if (target.kind === 'commit') {
    const commit = await repo.getCommit(target.sha);
    const [original, modified] = await Promise.all([
      fromTree(repo, await firstParentTree(commit), originalPath),
      fromTree(repo, await commit.getTree(), target.path),
    ]);
    return { original, modified };
  }
  if (target.staged) {
    const [original, modified] = await Promise.all([fromTree(repo, await headTree(repo), originalPath), fromIndex(repo, target.path)]);
    return { original, modified };
  }
  const [original, modified] = await Promise.all([fromIndex(repo, originalPath), fromWorkingTree(root, target.path)]);
  return { original, modified };
}
