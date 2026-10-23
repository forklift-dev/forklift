// Embedded terminals: main ↔ pty host (utilityProcess) protocol, and what windows see.

export type PtyRequest =
  | { type: 'create'; id: number; shell: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number }
  | { type: 'write'; id: number; data: string }
  | { type: 'resize'; id: number; cols: number; rows: number }
  | { type: 'kill'; id: number };

export type PtyEvent =
  | { type: 'created'; id: number; pid: number }
  | { type: 'data'; id: number; data: string }
  | { type: 'exit'; id: number; exitCode: number }
  | { type: 'error'; id: number; message: string };

/** Main → window, on the `terminal:event` channel. */
export type TerminalEvent = { type: 'data'; id: number; data: string } | { type: 'exit'; id: number; exitCode: number };

export const TERMINAL_EVENT_CHANNEL = 'terminal:event';
export const TERMINAL_INPUT_CHANNEL = 'terminal:input';
