import type { Dictionary } from './index';

export type TranslationEntry = string | Readonly<Record<string, string>>;
export type TranslationCatalog = Readonly<Record<string, TranslationEntry>>;

const tokens = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
const sameTokens = (left: string, right: string): boolean => JSON.stringify(tokens(left)) === JSON.stringify(tokens(right));
const sorted = (catalog: Record<string, TranslationEntry>) => Object.fromEntries(Object.entries(catalog).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));

/** A language code accepted by Intl and suitable for a catalog filename. */
export function validLocaleCode(code: string): boolean {
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(code)) return false;
  try {
    return Intl.PluralRules.supportedLocalesOf(code).length > 0;
  } catch {
    return false;
  }
}

/** The form names a new language can translate; missing forms use English at runtime. */
export function pluralCategories(code: string): string[] {
  return new Intl.PluralRules(code).resolvedOptions().pluralCategories;
}

/** Reports a row error without assuming that the target locale is complete. */
export function entryError(source: string | Readonly<Record<string, string>>, entry: TranslationEntry, locale: string): string | null {
  const sourceText = typeof source === 'string' ? source : source.other;
  if (!sourceText) return 'English source is missing';
  if (typeof source === 'string') {
    if (typeof entry !== 'string') return 'This message needs one text value';
    if (!entry.trim()) return 'Translation is empty';
    return sameTokens(sourceText, entry) ? null : `Keep the source parameters: ${tokens(sourceText).map((token) => `{${token}}`).join(', ') || '(none)'}`;
  }
  if (typeof entry === 'string') return 'This message needs plural forms';
  const allowed = new Set(pluralCategories(locale));
  for (const [form, text] of Object.entries(entry)) {
    if (!allowed.has(form)) return `Unknown plural form: ${form}`;
    if (!text.trim()) return `Plural form ${form} is empty`;
    if (!sameTokens(sourceText, text)) return `Plural form ${form} must keep the source parameters`;
  }
  return Object.keys(entry).length ? null : 'No plural forms translated';
}

/** Exports only translated entries. An invalid entry blocks export; empty rows remain English fallbacks. */
export function exportTranslationCatalog(source: Dictionary, draft: TranslationCatalog, locale: string): string {
  if (!validLocaleCode(locale)) throw new Error(`Invalid language code: ${locale}`);
  const output: Record<string, TranslationEntry> = {};
  for (const [id, value] of Object.entries(draft)) {
    const english = source[id];
    if (english === undefined) throw new Error(`Unknown message ID: ${id}`);
    const entry = typeof value === 'string' ? value.trim() : Object.fromEntries(Object.entries(value).filter(([, text]) => text.trim()).map(([form, text]) => [form, text.trim()]));
    if (typeof entry === 'string' ? !entry : !Object.keys(entry).length) continue;
    const error = entryError(english, entry, locale);
    if (error) throw new Error(`${id}: ${error}`);
    output[id] = entry;
  }
  return `${JSON.stringify(sorted(output), null, 2)}\n`;
}
