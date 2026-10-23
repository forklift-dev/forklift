import type { AskPromptKind } from '../../shared/state';

export const ASKPASS_FLAG = '--forklift-askpass';
export const SOCKET_ENV = 'FORKLIFT_ASKPASS_SOCKET';
export const TOKEN_ENV = 'FORKLIFT_ASKPASS_TOKEN';

/** As the helper's first argument: git runs us as its credential helper (`… credential get|store|erase`). */
export const CREDENTIAL_ARG = 'credential';
export type CredentialAction = 'get' | 'store' | 'erase';

/** One line of JSON each way: a prompt to show, or a credential helper call with git's fields. */
export type AskRequest = { token: string; prompt: string } | { token: string; credential: { action: CredentialAction; fields: Record<string, string> } };
export type AskResponse = { answer: string } | { cancel: true } | { fields: Record<string, string> };

/** What kind of answer git or ssh is asking for, from the prompt text (git and OpenSSH wording, English). */
export function classifyPrompt(prompt: string): AskPromptKind {
  if (/continue connecting \(yes\/no/i.test(prompt)) return 'confirm';
  if (/^Username for /i.test(prompt)) return 'username';
  if (/passphrase/i.test(prompt)) return 'passphrase';
  if (/password|token|PIN/i.test(prompt)) return 'password';
  return 'other';
}
