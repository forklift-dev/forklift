// Types for the unit tests that use the mock server.
export interface GitLabMock {
  url: string;
  requests: Array<{ method: string; path: string; authorized: boolean; git?: boolean; accept?: string }>;
  mrs: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
  notes: Record<string, Array<Record<string, unknown>>>;
  close(): Promise<void>;
}

export function startGitLabMock(options?: { token?: string; user?: string; fullName?: string; gitRoot?: string | null }): Promise<GitLabMock>;
