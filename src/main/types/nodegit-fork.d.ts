// Native extensions of GitKraken's fork that @types/nodegit describes differently (a module, so this augments).
export {};

declare module 'nodegit/rev-walk' {
  interface CommitWalkSignature {
    name: string;
    email: string;
    /** Milliseconds since the epoch. */
    date: number;
  }

  interface CommitWalkCommit {
    sha: string;
    message: string;
    author: CommitWalkSignature;
    committer: CommitWalkSignature;
    parents: string[];
  }

  interface Revwalk {
    /** Next `maxCount` commits as plain objects, read on a worker thread; fewer at the end of history. */
    commitWalk(maxCount: number, options: { returnPlainObjects: true }): Promise<CommitWalkCommit[]>;
  }
}
