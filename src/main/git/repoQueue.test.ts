import { describe, expect, it } from 'vitest';
import { RepoQueue } from './repoQueue';

describe('RepoQueue', () => {
  it('runs one task at a time per repository and reports when idle', async () => {
    const queue = new RepoQueue();
    const order: string[] = [];
    const slow = (name: string, ms: number) => () => new Promise<void>((resolve) => setTimeout(() => (order.push(name), resolve()), ms));
    void queue.run('/a', slow('a1', 30));
    void queue.run('/a', slow('a2', 1));
    void queue.run('/b', slow('b1', 5));
    await queue.idle('/a');
    expect(order).toEqual(['b1', 'a1', 'a2']);
    await queue.idle('/nothing');
  });
});
