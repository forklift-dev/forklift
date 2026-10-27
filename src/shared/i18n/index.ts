// Interface languages. English source and Russian translations live in editable JSON catalogs. A UI string's
// English text remains its key; a missing Russian translation does not compile. Git output is never translated.
import { EN, RU } from './strings';

export const LANGUAGES = ['en', 'ru'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Forms by Intl.PluralRules category: English uses one/other, Russian one/few/many (and other for fractions). */
export interface PluralForms {
  one: string;
  few?: string;
  many?: string;
  other: string;
}

export type Dictionary = Readonly<Record<string, string | PluralForms>>;

/**
 * A UI string: its English text with `{name}` placeholders. The same English meaning different things gets a
 * context prefix, `context|text` (a lowercase word before the bar), shown without it in English.
 */
export type Message = keyof typeof RU & string;
export type Params = Readonly<Record<string, string | number>>;

const DICTIONARIES: Record<Language, Dictionary> = { en: EN, ru: RU };
const CONTEXT = /^[a-z][a-z-]*\|/;

let current: Language = 'en';

export function setLanguage(language: Language): void {
  current = language;
}

export function currentLanguage(): Language {
  return current;
}

/** The language a setting asks for: `system` takes the first supported of the system's languages, else English. */
export function resolveLanguage(setting: string, system: readonly string[]): Language {
  if ((LANGUAGES as readonly string[]).includes(setting)) return setting as Language;
  for (const tag of system) {
    const base = tag.toLowerCase().split(/[-_]/)[0]!;
    if ((LANGUAGES as readonly string[]).includes(base)) return base as Language;
  }
  return 'en';
}

/** `message` in the current language, placeholders filled from `params` (`count` also picks the plural form). */
export function t(message: Message, params?: Params): string {
  return translate(message, params);
}

/** For text known only at run time (setting labels, command titles): translated when a dictionary has it. */
export function translate(message: string, params?: Params): string {
  const entry = DICTIONARIES[current][message] ?? (EN as Dictionary)[message];
  const text = entry === undefined ? english(message) : typeof entry === 'string' ? entry : pluralForm(entry, params?.count);
  return params ? fill(text, params) : text;
}

/** The English text of a message (without its context). */
export const english = (message: string): string => message.replace(CONTEXT, '');

const pluralRules = new Map<Language, Intl.PluralRules>();

function pluralForm(forms: PluralForms, count: string | number | undefined): string {
  let rules = pluralRules.get(current);
  if (!rules) pluralRules.set(current, (rules = new Intl.PluralRules(current)));
  const category = rules.select(Number(count ?? 0)) as keyof PluralForms;
  return forms[category] ?? forms.other;
}

/** Replaces `{name}` with params.name (left as is when not given). */
export function fill(text: string, params: Params): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** A date (ms since the epoch) in the current language's format. */
export function formatDate(time: number, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  const key = `${current}:${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) dateFormats.set(key, (format = new Intl.DateTimeFormat(current, options)));
  return format.format(time);
}
