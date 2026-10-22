import { basename } from 'node:path';
import { Branch, Graph, Reference, Repository, type StatusFile } from '@axosoft/nodegit';
import type { BranchInfo, ChangeKind, Commit, FileChange, RepoData } from '../../shared/state';
import { INDEX_MASK, OBJECT_TYPE_COMMIT, SORT, STATUS, STATUS_OPT, WORKTREE_MASK } from './libgit2';

export interface GitService {
  /** Resolves any path inside a working tree to the repository root; throws when it is not a repository. */
  resolveRoot(path: string): Promise<string>;
  read(root: string): Promise<RepoData>;
}

const MAX_COMMITS = 1000;

// Equivalent of `git log --all` without stashes.
const WALK_GLOBS = ['refs/heads/*', 'refs/remotes/*', 'refs/tags/*'];

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
      const [branch, refLabels, changes] = await Promise.all([
        readBranch(repo, head),
        readRefLabels(repo, head),
        readChanges(repo),
      ]);
      return {
        root,
        name: basename(root),
        branch,
        commits: await readCommits(repo, head !== null, refLabels),
        changes,
        loadedAt: Date.now(),
      };
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

/** Builds `git log --decorate` style labels keyed by commit sha. */
async function readRefLabels(repo: Repository, head: Reference | null): Promise<Map<string, string[]>> {
  const labels = new Map<string, string[]>();
  const add = (sha: string, label: string) => {
    const list = labels.get(sha);
    if (list) list.push(label);
    else labels.set(sha, [label]);
  };

  const headName = head && !repo.headDetached() ? head.name() : null;
  if (head && headName === null) add(head.target().tostrS(), 'HEAD');

  for (const ref of await repo.getReferences()) {
    if (ref.isSymbolic() || !(ref.isBranch() || ref.isRemote() || ref.isTag())) continue;
    // Annotated tags point at a tag object; peel to the commit it labels.
    const target = ref.isTag() ? (await ref.peel(OBJECT_TYPE_COMMIT)).id() : ref.target();
    const name = ref.shorthand();
    if (ref.isTag()) add(target.tostrS(), `tag: ${name}`);
    else if (ref.name() === headName) add(target.tostrS(), `HEAD -> ${name}`);
    else add(target.tostrS(), name);
  }

  // Keep HEAD first, matching git's own ordering.
  for (const list of labels.values()) list.sort((a, b) => Number(b.startsWith('HEAD')) - Number(a.startsWith('HEAD')));
  return labels;
}

async function readCommits(repo: Repository, hasHead: boolean, refLabels: Map<string, string[]>): Promise<Commit[]> {
  const walk = repo.createRevWalk();
  walk.sorting(SORT.TOPOLOGICAL, SORT.TIME);
  if (hasHead) walk.pushHead();
  for (const glob of WALK_GLOBS) walk.pushGlob(glob);

  const commits = await walk.getCommits(MAX_COMMITS).catch(() => []);
  return commits.map((commit) => {
    const author = commit.author();
    const hash = commit.sha();
    return {
      hash,
      parents: commit.parents().map((oid) => oid.tostrS()),
      authorName: author.name(),
      authorEmail: author.email(),
      authorTime: author.when().time(),
      refs: refLabels.get(hash) ?? [],
      subject: commit.summary() ?? '',
    };
  });
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
