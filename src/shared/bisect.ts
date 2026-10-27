export type BisectMark = 'good' | 'bad' | 'skip';

export interface BisectStatus {
  good: string[];
  bad: string | null;
  skipped: string[];
  candidates: string[];
  remaining: number | null;
  steps: number | null;
  tested: number;
  found: string | null;
  log: string;
}

export interface BisectActivity {
  running: boolean;
  output: string[];
}
