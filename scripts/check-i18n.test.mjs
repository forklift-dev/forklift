import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./check-i18n.mjs', import.meta.url));

function fixture(t, en = { 'Hello {name}': 'Hello {name}' }, ru = { 'Hello {name}': 'Привет {name}' }, code = "t('Hello {name}')") {
  const root = mkdtempSync(join(tmpdir(), 'forklift-i18n-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const catalogs = join(root, 'catalogs');
  const src = join(root, 'src');
  mkdirSync(catalogs);
  mkdirSync(src);
  writeFileSync(join(catalogs, 'en.json'), `${JSON.stringify(en, null, 2)}\n`);
  writeFileSync(join(catalogs, 'ru.json'), `${JSON.stringify(ru, null, 2)}\n`);
  writeFileSync(join(src, 'view.ts'), code);
  return { catalogs, src, run: (...args) => spawnSync(process.execPath, [checker, '--catalog-dir', catalogs, '--source-dir', src, ...args], { encoding: 'utf8' }) };
}

test('valid catalogs pass', (t) => {
  const result = fixture(t).run();
  if (result.status !== 0) throw new Error(result.stderr);
});

test('duplicate keys, bad parameters, new and unused strings fail clearly', (t) => {
  const data = fixture(t, { 'Hello {name}': 'Hello {name}' }, { 'Hello {name}': 'Привет {other}' }, "t('New message')");
  writeFileSync(join(data.catalogs, 'en.json'), '{"Hello {name}":"Hello {name}","Hello {name}":"Hello {name}"}');
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
  if (en['Hello {name}'] !== 'Hello {name}') throw new Error('English source was not added');
});
