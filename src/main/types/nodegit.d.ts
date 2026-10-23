// GitKraken's nodegit fork ships no typings; it tracks upstream nodegit 0.28, which @types/nodegit describes.
declare module '@axosoft/nodegit' {
  export * from 'nodegit';
}

// GitKraken's native repository finder (MIT); the package has no typings.
declare module 'find-git-repositories' {
  function findGitRepos(
    path: string,
    progress: (repositories: string[]) => boolean | void,
    options?: { throttleTimeoutMS?: number; maxSubfolderDeep?: number },
  ): Promise<string[]>;
  export = findGitRepos;
}

