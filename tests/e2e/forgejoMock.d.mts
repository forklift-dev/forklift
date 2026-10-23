// Types for the unit tests that use the mock server.
export interface ForgejoMock {
  url: string;
  requests: Array<{ method: string; path: string; authorized: boolean; git?: boolean; accept?: string }>;
  pulls: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
  comments: Record<string, Array<Record<string, unknown>>>;
  /** GitHub flavor: answer `n` more requests, then report the rate limit. */
  limit(n: number): void;
  close(): Promise<void>;
}

export function startForgejoMock(options?: { token?: string; user?: string; fullName?: string; gitRoot?: string | null; flavor?: 'forgejo' | 'gitverse' | 'github' }): Promise<ForgejoMock>;
