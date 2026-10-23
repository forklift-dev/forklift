/**
 * Serializes operations that write a repository (index, HEAD, working tree): one at a time per
 * repository, so they never fight over index.lock; different repositories do not wait for each other.
 */
export class RepoQueue {
  private readonly queues = new Map<string, Promise<unknown>>();

  run<T>(root: string, task: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(root) ?? Promise.resolve()).then(task, task);
    const settled = run.catch(() => {});
    this.queues.set(root, settled);
    void settled.then(() => {
      if (this.queues.get(root) === settled) this.queues.delete(root);
    });
    return run;
  }
}
