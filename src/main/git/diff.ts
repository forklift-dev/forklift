import { lstat, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Diff, type Blob, type Commit, type Repository, type Tree } from '@axosoft/nodegit';
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
import { DELTA, DIFF_FIND_RENAMES, DIFF_FLAG_BINARY } from './libgit2';

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

const missing = (path: string): FileVersion => ({ path, exists: false, binary: false, tooLarge: false, size: 0, text: null });

function fromBytes(path: string, bytes: Buffer, binary: boolean): FileVersion {
  return {
    path,
    exists: true,
    binary,
    tooLarge: false,
    size: bytes.length,
    // Invalid UTF-8 is shown with replacement characters rather than failing the whole diff.
    text: binary ? null : new TextDecoder().decode(bytes),
  };
}

function fromBlob(path: string, blob: Blob): FileVersion {
  const size = blob.rawsize();
  if (size > MAX_DIFF_FILE_BYTES) return { path, exists: true, binary: false, tooLarge: true, size, text: null };
  return fromBytes(path, blob.content(), blob.isBinary() !== 0);
}

async function fromTree(repo: Repository, tree: Tree | undefined, path: string): Promise<FileVersion> {
  if (!tree) return missing(path);
  const entry = await tree.getEntry(path).catch(() => null);
  if (!entry) return missing(path);
  if (entry.isSubmodule()) return fromBytes(path, Buffer.from(`Subproject commit ${entry.sha()}\n`), false);
  return fromBlob(path, await repo.getBlob(entry.id()));
}

async function fromIndex(repo: Repository, path: string): Promise<FileVersion> {
  const index = await repo.refreshIndex();
  const entry = index.getByPath(path, 0); // stage 0: absent while the file is conflicted
  return entry ? fromBlob(path, await repo.getBlob(entry.id)) : missing(path);
}

async function fromWorkingTree(root: string, path: string): Promise<FileVersion> {
  const fullPath = join(root, path);
  const stats = await lstat(fullPath).catch(() => null);
  if (!stats) return missing(path);
  // git stores a symlink as its target path, so compare that rather than the file it points to.
  if (stats.isSymbolicLink()) return fromBytes(path, Buffer.from(await readlink(fullPath)), false);
  if (stats.size > MAX_DIFF_FILE_BYTES) return { path, exists: true, binary: false, tooLarge: true, size: stats.size, text: null };
  const bytes = await readFile(fullPath);
  return fromBytes(path, bytes, bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0));
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
