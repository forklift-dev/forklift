// Author avatars: colored initials by default (no network); Gravatar images only when the user turns it on.

/** Up to two initials from a name ("Ada Lovelace" → "AL"), else from the email. */
export function initials(name: string, email = ''): string {
  const words = name
    .replace(/[<>()[\]"',.]/g, ' ')
    .split(/\s+/)
    .filter((word) => /\p{L}|\p{N}/u.test(word));
  const first = (word: string) => [...word].find((char) => /\p{L}|\p{N}/u.test(char)) ?? '';
  const letters = words.length >= 2 ? first(words[0]!) + first(words.at(-1)!) : words.length === 1 ? first(words[0]!) : first(email);
  return letters.toLocaleUpperCase() || '?';
}

/** Gravatar normalizes addresses this way before hashing. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** A stable small number for an email (FNV-1a), e.g. to pick one of the theme's 10 graph colors. */
export function colorIndex(email: string, colors = 10): number {
  let hash = 0x811c9dc5;
  for (const char of normalizeEmail(email)) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % colors;
}

export const MAX_AVATAR_REQUEST = 100;
