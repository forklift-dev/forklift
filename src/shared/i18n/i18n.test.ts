import { afterEach, describe, expect, it } from 'vitest';
import { english, fill, formatDate, resolveLanguage, setLanguage, t, translate, type PluralForms } from './index';
import { PARTS } from './strings';

afterEach(() => setLanguage('en'));

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const forms = (entry: string | PluralForms) => (typeof entry === 'string' ? [entry] : Object.values(entry));

describe('dictionaries', () => {
  const parts = Object.entries(PARTS) as Array<[string, { ru: Record<string, string | PluralForms>; en: Record<string, string | PluralForms> }]>;

  it('translate every message with the same placeholders as its English text', () => {
    for (const [part, { ru, en }] of parts) {
      for (const [message, entry] of Object.entries(ru)) {
        const source = en[message] ?? english(message);
        for (const form of [...forms(entry), ...forms(source)]) expect(placeholders(form), `${part}: ${message}`).toEqual(placeholders(english(message)));
      }
    }
  });

  it('give plural messages Russian one/few/many and English one/other forms, and count among the placeholders', () => {
    for (const [part, { ru, en }] of parts) {
      for (const [message, entry] of Object.entries(ru)) {
        if (typeof entry === 'string') {
          expect(en[message], `${part}: ${message} has English plural forms but no Russian ones`).toBeUndefined();
          continue;
        }
        expect(Object.keys(entry).sort(), `${part}: ${message}`).toEqual(expect.arrayContaining(['few', 'many', 'one']));
        expect(en[message], `${part}: ${message} needs English forms`).toMatchObject({ one: expect.any(String), other: expect.any(String) });
        expect(placeholders(message), `${part}: ${message}`).toContain('count');
      }
      for (const message of Object.keys(en)) expect(ru[message], `${part}: English forms of ${message} without a translation`).toBeDefined();
    }
  });

  it('do not translate one message differently in two parts', () => {
    const seen = new Map<string, [string, string]>();
    for (const [part, { ru }] of parts) {
      for (const [message, entry] of Object.entries(ru)) {
        const value = JSON.stringify(entry);
        const earlier = seen.get(message);
        if (earlier) expect(value, `${message}: ${earlier[0]} and ${part} differ`).toBe(earlier[1]);
        else seen.set(message, [part, value]);
      }
    }
  });
});

describe('t', () => {
  it('is English by default and Russian when chosen', () => {
    expect(t('Cancel')).toBe('Cancel');
    setLanguage('ru');
    expect(t('Cancel')).toBe('Отмена');
  });

  it('picks plural forms by count', () => {
    expect(t('{count} files', { count: 1 })).toBe('1 file');
    expect(t('{count} files', { count: 5 })).toBe('5 files');
    setLanguage('ru');
    expect([1, 2, 5, 21, 22, 25, 111].map((count) => t('{count} files', { count }))).toEqual(['1 файл', '2 файла', '5 файлов', '21 файл', '22 файла', '25 файлов', '111 файлов']);
  });

  it('shows run-time text as it is when no dictionary has it, and drops a context prefix in English', () => {
    setLanguage('ru');
    expect(translate('Something new {x}', { x: 1 })).toBe('Something new 1');
    expect(english('verb|Open')).toBe('Open');
    expect(translate('verb|Open')).toBe('Open');
    expect(english('Status: a|b')).toBe('Status: a|b');
  });

  it('fills only the placeholders given', () => {
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });
});

describe('resolveLanguage', () => {
  it('takes the setting, else the first supported system language, else English', () => {
    expect(resolveLanguage('ru', ['en-US'])).toBe('ru');
    expect(resolveLanguage('system', ['ru-RU', 'en-US'])).toBe('ru');
    expect(resolveLanguage('system', ['de-DE', 'ru'])).toBe('ru');
    expect(resolveLanguage('system', ['ru_RU.UTF-8'])).toBe('ru');
    expect(resolveLanguage('system', ['de-DE'])).toBe('en');
    expect(resolveLanguage('system', [])).toBe('en');
  });
});

describe('formatDate', () => {
  it('follows the language', () => {
    const time = Date.UTC(2026, 9, 26, 12);
    expect(formatDate(time, { month: 'long', timeZone: 'UTC' })).toBe('October');
    setLanguage('ru');
    expect(formatDate(time, { month: 'long', timeZone: 'UTC' })).toBe('октябрь');
  });
});
