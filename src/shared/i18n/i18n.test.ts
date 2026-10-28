import { afterEach, describe, expect, it } from 'vitest';
import { english, fill, formatDate, formatNumber, LANGUAGES, resolveLanguage, setLanguage, t, translate, type PluralForms } from './index';
import { EN, RU } from './strings';

afterEach(() => setLanguage('en'));

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const forms = (entry: string | PluralForms) => (typeof entry === 'string' ? [entry] : Object.values(entry));

describe('dictionaries', () => {
  const en = EN as Record<string, string | PluralForms>;
  const ru = RU as Record<string, string | PluralForms>;

  it('translate every message with the same placeholders as its English text', () => {
    for (const [message, entry] of Object.entries(ru)) {
      const source = en[message]!;
      for (const form of [...forms(entry), ...forms(source)]) expect(placeholders(form), message).toEqual(placeholders(english(message)));
    }
  });

  it('give plural messages Russian one/few/many and English one/other forms, and count among the placeholders', () => {
    for (const [message, entry] of Object.entries(ru)) {
      if (typeof entry === 'string') {
        expect(typeof en[message], `${message} has English plural forms but no Russian ones`).toBe('string');
        continue;
      }
      expect(Object.keys(entry).sort(), message).toEqual(expect.arrayContaining(['few', 'many', 'one']));
      expect(en[message], `${message} needs English forms`).toMatchObject({ one: expect.any(String), other: expect.any(String) });
      expect(placeholders(message), message).toContain('count');
    }
  });

  it('have matching source and translation keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
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

  it('falls back to English for missing German messages and plural forms', () => {
    setLanguage('de');
    expect(t('Cancel')).toBe('Abbrechen');
    expect(t('Save')).toBe('Save');
    expect(t('{count} files', { count: 1 })).toBe('1 Datei');
    expect(t('{count} files', { count: 2 })).toBe('2 files');
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
    expect(resolveLanguage('system', ['de-DE', 'ru'])).toBe('de');
    expect(resolveLanguage('system', ['ru_RU.UTF-8'])).toBe('ru');
    expect(resolveLanguage('system', ['de-DE'])).toBe('de');
    expect(resolveLanguage('de', ['ru-RU'])).toBe('de');
    expect(resolveLanguage('system', ['fr-FR'])).toBe('en');
    expect(resolveLanguage('system', [])).toBe('en');
  });
});

describe('formatDate', () => {
  it('follows the language', () => {
    const time = Date.UTC(2026, 9, 26, 12);
    expect(formatDate(time, { month: 'long', timeZone: 'UTC' })).toBe('October');
    setLanguage('ru');
    expect(formatDate(time, { month: 'long', timeZone: 'UTC' })).toBe('октябрь');
    setLanguage('de');
    expect(formatDate(time, { month: 'long', timeZone: 'UTC' })).toBe('Oktober');
    expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat('de').format(1234.5));
  });
});

describe('Community edition promise', () => {
  it('has the promise and quote attribution in every interface language', () => {
    for (const language of LANGUAGES) {
      setLanguage(language);
      expect(t('This edition will always be open and free, with no paid features.').trim(), language).not.toBe('');
      expect(t('— attributed to Marcus Tullius (a modern aphorism with no established source)').trim(), language).not.toBe('');
    }
    setLanguage('ru');
    expect(t('This edition will always be open and free, with no paid features.')).toBe('Версия всегда будет открытой и бесплатной, без платного функционала.');
    expect(t('— attributed to Marcus Tullius (a modern aphorism with no established source)')).toContain('приписывается Марку Туллию');
  });
});
