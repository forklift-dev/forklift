import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const checker = fileURLToPath(new URL('./check-i18n.mjs', import.meta.url));
const idFor = (key) => `msg.${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
const identified = (catalog) => Object.fromEntries(Object.entries(catalog).map(([key, value]) => [idFor(key), value]).sort(([a], [b]) => a.localeCompare(b)));

function fixture(t, en = { 'Hello {name}': 'Hello {name}' }, ru = { 'Hello {name}': 'Привет {name}' }, code = "t('Hello {name}')") {
  const root = mkdtempSync(join(tmpdir(), 'forklift-i18n-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const catalogs = join(root, 'catalogs');
  const src = join(root, 'src');
  mkdirSync(catalogs);
  mkdirSync(src);
  writeFileSync(join(root, 'locales.json'), JSON.stringify([{ code: 'en', name: 'English' }, { code: 'ru', name: 'Русский' }]));
  writeFileSync(join(root, 'legacy.json'), `${JSON.stringify(Object.fromEntries([...new Set([...Object.keys(en), ...Object.keys(ru)])].sort().map((key) => [key, idFor(key)])), null, 2)}\n`);
  writeFileSync(join(catalogs, 'en.json'), `${JSON.stringify(identified(en), null, 2)}\n`);
  writeFileSync(join(catalogs, 'ru.json'), `${JSON.stringify(identified(ru), null, 2)}\n`);
  writeFileSync(join(src, 'view.ts'), code);
  return { catalogs, src, run: (...args) => spawnSync(process.execPath, [checker, '--catalog-dir', catalogs, '--source-dir', src, ...args], { encoding: 'utf8' }) };
}

test('valid catalogs pass', (t) => {
  const result = fixture(t).run();
  if (result.status !== 0) throw new Error(result.stderr);
});

test('partial third locale is counted and validated', (t) => {
  const data = fixture(t);
  writeFileSync(join(data.catalogs, '..', 'locales.json'), JSON.stringify([{ code: 'en', name: 'English' }, { code: 'ru', name: 'Русский' }, { code: 'de', name: 'Deutsch' }]));
  writeFileSync(join(data.catalogs, 'de.json'), JSON.stringify(identified({ 'Hello {name}': 'Hallo {name}' })));
  const result = data.run();
  if (result.status !== 0 || !/de: 1\/1 entries translated; incomplete plural entries: 0/.test(result.stdout)) throw new Error(result.stderr || result.stdout);
  writeFileSync(join(data.catalogs, 'de.json'), JSON.stringify(identified({ 'Hello {name}': 'Hallo {wrong}' })));
  const invalid = data.run();
  if (invalid.status === 0 || !/different placeholders/.test(invalid.stderr)) throw new Error(invalid.stderr);
});

test('an updated translation and a partial plural entry pass with a clear coverage report', (t) => {
  const data = fixture(t, { 'Hello {name}': 'Hello {name}', '{count} files': { one: '{count} file', other: '{count} files' } }, { 'Hello {name}': 'Здравствуйте, {name}', '{count} files': { one: '{count} файл', few: '{count} файла', many: '{count} файлов', other: '{count} файла' } }, "t('Hello {name}'); t('{count} files')");
  writeFileSync(join(data.catalogs, '..', 'locales.json'), JSON.stringify([{ code: 'en', name: 'English' }, { code: 'ru', name: 'Русский' }, { code: 'de', name: 'Deutsch' }]));
  writeFileSync(join(data.catalogs, 'de.json'), JSON.stringify(identified({ 'Hello {name}': 'Hallo {name}', '{count} files': { one: '{count} Datei' } })));
  const result = data.run();
  if (result.status !== 0 || !/de: 2\/2 entries translated; incomplete plural entries: 1/.test(result.stdout)) throw new Error(result.stderr || result.stdout);
});

test('invalid JSON reports the catalog without a stack trace', (t) => {
  const data = fixture(t);
  writeFileSync(join(data.catalogs, 'ru.json'), '{broken');
  const result = data.run();
  if (result.status === 0 || !/^ru\.json: /m.test(result.stderr) || /at file:/.test(result.stderr)) throw new Error(result.stderr);
});

test('duplicate keys, bad parameters, new and unused strings fail clearly', (t) => {
  const data = fixture(t, { 'Hello {name}': 'Hello {name}' }, { 'Hello {name}': 'Привет {other}' }, "t('New message')");
  writeFileSync(join(data.catalogs, 'en.json'), `{ "${idFor('Hello {name}')}": "Hello {name}", "${idFor('Hello {name}')}": "Hello {name}" }`);
  const result = data.run();
  if (result.status === 0 || !/duplicate key/.test(result.stderr) || !/different placeholders/.test(result.stderr) || !/missing from catalogs/.test(result.stderr) || !/unused message/.test(result.stderr)) {
    throw new Error(result.stderr);
  }
  const before = readFileSync(join(data.catalogs, 'en.json'), 'utf8');
  const sync = data.run('--sync');
  if (sync.status === 0 || readFileSync(join(data.catalogs, 'en.json'), 'utf8') !== before) throw new Error('sync rewrote a catalog with duplicate keys');
});

test('sync adds and sorts English source after a translation is added', (t) => {
  const data = fixture(t, {}, { 'Hello {name}': 'Привет {name}' });
  const result = data.run('--sync');
  if (result.status !== 0) throw new Error(result.stderr);
  const en = JSON.parse(readFileSync(join(data.catalogs, 'en.json'), 'utf8'));
  if (en[idFor('Hello {name}')] !== 'Hello {name}') throw new Error('English source was not added');
});

test('English rewording keeps a stable ID and an existing translation', (t) => {
  const data = fixture(t);
  writeFileSync(join(data.catalogs, 'en.json'), JSON.stringify({ [idFor('Hello {name}')]: 'Welcome {name}' }));
  const result = data.run();
  if (result.status !== 0) throw new Error(result.stderr);
});

test('renamed IDs and duplicate IDs are rejected', (t) => {
  const data = fixture(t);
  writeFileSync(join(data.catalogs, '..', 'legacy.json'), JSON.stringify({ 'Hello {name}': 'msg.renamed' }));
  const result = data.run();
  if (result.status === 0 || !/renamed or invalid ID/.test(result.stderr)) throw new Error(result.stderr);
  writeFileSync(join(data.catalogs, '..', 'legacy.json'), JSON.stringify({ 'Hello {name}': idFor('Hello {name}'), 'Hi {name}': idFor('Hello {name}') }));
  const duplicate = data.run();
  if (duplicate.status === 0 || !/two English keys use the same message ID/.test(duplicate.stderr)) throw new Error(duplicate.stderr);
});

test('sync leaves an unknown ID untouched', (t) => {
  const data = fixture(t);
  const file = join(data.catalogs, 'en.json');
  const before = readFileSync(file, 'utf8');
  writeFileSync(join(data.catalogs, 'ru.json'), JSON.stringify({ ...identified({ 'Hello {name}': 'Привет {name}' }), 'msg.unknown': 'extra' }));
  const result = data.run('--sync');
  if (result.status === 0 || !/unknown message ID/.test(result.stderr) || readFileSync(file, 'utf8') !== before) throw new Error(result.stderr);
});
