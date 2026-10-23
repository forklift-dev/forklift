import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { Branch, Graph, Reference, Remote, Repository, Stash, type Oid, type StatusFile } from '@axosoft/nodegit';
import type { CommitDetails, DiffTarget, FileDiff } from '../../shared/diff';
import type { BranchInfo, ChangeKind, FileChange, LocalBranch, RemoteBranch, RepoData, StashInfo, TagInfo } from '../../shared/state';
import { readCommitDetails, readFileDiff, readStashDetails } from './diff';
import { INDEX_MASK, OBJECT_TYPE_COMMIT, STATUS, STATUS_OPT, WORKTREE_MASK } from './libgit2';

export interface GitService {
  /** Resolves any path inside a working tree to the repository root; throws when it is not a repository. */
  resolveRoot(path: string): Promise<string>;
  read(root: string): Promise<RepoData>;
  commitDetails(root: string, sha: string): Promise<CommitDetails>;
  /** A stash's changes against its base, with the untracked files it saved. */
  stashDetails(root: string, sha: string): Promise<CommitDetails>;
  fileDiff(root: string, target: DiffTarget): Promise<FileDiff>;
}

// Equivalent of `git log --all` without stashes.
export const WALK_GLOBS = ['refs/heads/*', 'refs/remotes/*', 'refs/tags/*'];

/**
 * Identifies what the history walk starts from (HEAD and the walked refs); it changes exactly when the
 * history list may change, so windows know to reload it.
 */
export async function historyVersion(repo: Repository, stashes?: StashInfo[]): Promise<string> {
  const lines = [repo.headUnborn() ? 'HEAD unborn' : `HEAD ${(await repo.head()).target().tostrS()}`];
  // Stashes are drawn in the graph; dropping an older one changes only the list, not refs/stash.
  for (const stash of stashes ?? (await readStashes(repo))) lines.push(`stash ${stash.sha}`);
  for (const ref of await repo.getReferences()) {
    if (ref.isSymbolic() || !(ref.isBranch() || ref.isRemote() || ref.isTag())) continue;
    lines.push(`${ref.name()} ${ref.target().tostrS()}`);
  }
  return createHash('sha1').update(lines.sort().join('\n')).digest('hex');
}

export function createGitService(): GitService {
  return {
    async resolveRoot(path) {
      // openExt searches parent directories the same way `git rev-parse` does.
      const repo = await Repository.openExt(path, 0, '');
      const workdir = repo.workdir();
      if (!workdir) throw new Error('Bare repositories are not supported');
      return workdir.replace(/[\\/]+$/, '');
    },

    async read(root) {
      const repo = await Repository.open(root);
      const head = repo.headUnborn() ? null : await repo.head();
      const stashes = await readStashes(repo);
      const [branch, refs, changes, version, remotes] = await Promise.all([
        readBranch(repo, head),
        readRefs(repo, head),
        readChanges(repo),
        historyVersion(repo, stashes),
        Remote.list(repo) as Promise<string[]>,
      ]);
      return {
        root,
        name: basename(root),
        branch,
        branches: refs.branches,
        remoteBranches: refs.remoteBranches,
        tags: refs.tags,
        remotes: [...remotes].sort(),
        stashes,
        refs: Object.fromEntries(refs.labels),
        historyVersion: version,
        changes,
        loadedAt: Date.now(),
      };
    },

    async commitDetails(root, sha) {
      return readCommitDetails(await Repository.open(root), sha);
    },

    async stashDetails(root, sha) {
      return readStashDetails(await Repository.open(root), sha);
    },

    async fileDiff(root, target) {
      return readFileDiff(await Repository.open(root), root, target);
    },
  };
}

async function readBranch(repo: Repository, head: Reference | null): Promise<BranchInfo> {
  const info: BranchInfo = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 };
  if (!head) {
    // Unborn branch: HEAD names a branch that has no commits yet. Reference.lookup keeps the
    // symbolic ref as is; repo.getReference would try to resolve it and fail.
    const ref = await Reference.lookup(repo, 'HEAD').catch(() => null);
    info.head = ref?.symbolicTarget().replace(/^refs\/heads\//, '') ?? null;
    return info;
  }

  info.oid = head.target().tostrS();
  if (repo.headDetached()) return info;

  info.head = head.shorthand();
  const upstream = await Branch.upstream(head).catch(() => null);
  if (upstream) {
    info.upstream = upstream.shorthand();
    // Typed as number in @types/nodegit, but the binding resolves to { ahead, behind }.
    const counts = (await Graph.aheadBehind(repo, head.target(), upstream.target())) as unknown as {
      ahead: number;
      behind: number;
    };
    info.ahead = counts.ahead;
    info.behind = counts.behind;
  }
  return info;
}

/** The stash list, newest first (stash@{0}). */
export async function readStashes(repo: Repository): Promise<StashInfo[]> {
  const found: Array<{ index: number; message: string; sha: string }> = [];
  await Stash.foreach(repo, (index: number, message: string, oid: Oid) => {
    found.push({ index, message, sha: oid.tostrS() });
  }).catch(() => 0);
  const stashes: StashInfo[] = [];
  for (const entry of found.sort((a, b) => a.index - b.index)) {
    const commit = await repo.getCommit(entry.sha);
    stashes.push({ ...entry, base: commit.parentId(0).tostrS(), time: commit.time() });
  }
  return stashes;
}

interface Refs {
  /** `git log --decorate` style labels keyed by commit sha. */
  labels: Map<string, string[]>;
  branches: LocalBranch[];
  remoteBranches: RemoteBranch[];
  tags: TagInfo[];
}

/** Branches, remote branches and tags, plus the commit labels the history list shows. */
async function readRefs(repo: Repository, head: Reference | null): Promise<Refs> {
  const refs: Refs = { labels: new Map(), branches: [], remoteBranches: [], tags: [] };
  const add = (sha: string, label: string) => {
    const list = refs.labels.get(sha);
    if (list) list.push(label);
    else refs.labels.set(sha, [label]);
  };

  const headName = head && !repo.headDetached() ? head.name() : null;
  if (head && headName === null) add(head.target().tostrS(), 'HEAD');

  for (const ref of await repo.getReferences()) {
    if (ref.isSymbolic() || !(ref.isBranch() || ref.isRemote() || ref.isTag())) continue;
    const name = ref.shorthand();
    if (ref.isTag()) {
      // Annotated tags point at a tag object; peel to the commit it labels. Tags of trees or blobs are skipped.
      const commit = await ref.peel(OBJECT_TYPE_COMMIT).catch(() => null);
      if (!commit) continue;
      const sha = commit.id().tostrS();
      add(sha, `tag: ${name}`);
      refs.tags.push({ name, sha, annotated: !ref.target().equal(commit.id()) });
      continue;
    }
    const sha = ref.target().tostrS();
    if (ref.isRemote()) {
      add(sha, name);
      refs.remoteBranches.push({ name, remote: name.slice(0, name.indexOf('/')), sha });
      continue;
    }
    const current = ref.name() === headName;
    add(sha, current ? `HEAD -> ${name}` : name);
    refs.branches.push({ name, sha, current, ...(await readTracking(repo, ref)) });
  }

  // Keep HEAD first, matching git's own ordering.
  for (const list of refs.labels.values()) list.sort((a, b) => Number(b.startsWith('HEAD')) - Number(a.startsWith('HEAD')));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  refs.branches.sort(byName);
  refs.remoteBranches.sort(byName);
  refs.tags.sort(byName);
  return refs;
}

async function readTracking(repo: Repository, branch: Reference): Promise<Pick<LocalBranch, 'upstream' | 'ahead' | 'behind'>> {
  const upstream = await Branch.upstream(branch).catch(() => null);
  if (!upstream) return { upstream: null, ahead: 0, behind: 0 };
  // Typed as number in @types/nodegit, but the binding resolves to { ahead, behind }.
  const counts = (await Graph.aheadBehind(repo, branch.target(), upstream.target())) as unknown as { ahead: number; behind: number };
  return { upstream: upstream.shorthand(), ahead: counts.ahead, behind: counts.behind };
}

async function readChanges(repo: Repository): Promise<FileChange[]> {
  // getStatusExt (git_status_list) carries diff deltas, needed for rename sources;
  // getStatus (foreach) returns entries without them.
  const files = await repo.getStatusExt({
    flags:
      STATUS_OPT.INCLUDE_UNTRACKED |
      STATUS_OPT.RECURSE_UNTRACKED_DIRS |
      STATUS_OPT.RENAMES_HEAD_TO_INDEX |
      STATUS_OPT.RENAMES_INDEX_TO_WORKDIR,
  });
  return files.map(toFileChange);
}

function toFileChange(file: StatusFile): FileChange {
  const bits = file.statusBit();
  const conflicted = (bits & STATUS.CONFLICTED) !== 0;
  // libgit2 reports a conflict with the CONFLICTED bit alone; it needs the user's action, so it is unstaged.
  const staged = !conflicted && (bits & INDEX_MASK) !== 0;
  const unstaged = conflicted || (bits & WORKTREE_MASK) !== 0;
  const change: FileChange = { path: file.path(), kind: changeKind(bits), staged, unstaged };

  if (bits & STATUS.INDEX_RENAMED) change.origPath = file.headToIndex().oldFile().path();
  else if (bits & STATUS.WT_RENAMED) change.origPath = file.indexToWorkdir().oldFile().path();
  return change;
}

function changeKind(bits: number): ChangeKind {
  if (bits & STATUS.CONFLICTED) return 'conflicted';
  if (bits & (STATUS.INDEX_RENAMED | STATUS.WT_RENAMED)) return 'renamed';
  if (bits & STATUS.INDEX_NEW) return 'added';
  if (bits & STATUS.WT_NEW) return 'untracked';
  if (bits & (STATUS.INDEX_DELETED | STATUS.WT_DELETED)) return 'deleted';
  if (bits & (STATUS.INDEX_TYPECHANGE | STATUS.WT_TYPECHANGE)) return 'typechange';
  return 'modified';
}
