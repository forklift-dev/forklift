import { describe, expect, it } from 'vitest';
import { entryError, exportTranslationCatalog, pluralCategories, validLocaleCode } from './translation-editor';

const source = {
  'msg.a': 'Open {name}',
  'msg.b': { one: '{count} file', other: '{count} files' },
  'msg.c': 'Cancel',
};

describe('translation editor', () => {
  it('accepts an Intl locale and exposes its plural categories', () => {
    expect(validLocaleCode('de')).toBe(true);
    expect(validLocaleCode('../de')).toBe(false);
    expect(pluralCategories('de')).toEqual(expect.arrayContaining(['one', 'other']));
  });

  it('exports sorted translated rows while leaving omitted rows for English fallback', () => {
    const json = exportTranslationCatalog(source, { 'msg.b': { one: '{count} Datei', other: '' }, 'msg.a': '  {name} öffnen ', 'msg.c': '' }, 'de');
    expect(JSON.parse(json)).toEqual({ 'msg.a': '{name} öffnen', 'msg.b': { one: '{count} Datei' } });
    expect(json.indexOf('msg.a')).toBeLessThan(json.indexOf('msg.b'));
  });

  it('rejects missing parameters, wrong forms and unknown IDs before export', () => {
    expect(entryError(source['msg.a'], 'Öffnen', 'de')).toContain('{name}');
    expect(() => exportTranslationCatalog(source, { 'msg.a': 'Öffnen' }, 'de')).toThrow('msg.a');
    expect(() => exportTranslationCatalog(source, { 'msg.b': { few: '{count} Dateien' } }, 'de')).toThrow('Unknown plural form');
    expect(() => exportTranslationCatalog(source, { 'msg.unknown': 'Hallo' }, 'de')).toThrow('Unknown message ID');
  });
});
