import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseExpression } from '@babel/parser';

const root = new URL('../', import.meta.url);
const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const catalogDir = resolve(option('--catalog-dir') ?? fileURLToPath(new URL('../src/shared/i18n/catalogs/', import.meta.url)));
const sourceDir = resolve(option('--source-dir') ?? fileURLToPath(new URL('../src/', import.meta.url)));
const locales = ['en', 'ru'];
const requiredForms = { en: ['one', 'other'], ru: ['one', 'few', 'many', 'other'] };
const context = /^[a-z][a-z-]*\|/;
// These are selected through a typed runtime value; the plural example is an intentional test fixture.
const DYNAMIC_MESSAGES = new Set(['operation|cherry-pick', 'operation|merge', 'operation|rebase', 'operation|revert', '{count} files']);
const failures = [];
const fail = (message) => failures.push(message);
const sorted = (value) => Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');

function checkDuplicates(node, file, path = '') {
  if (node.type !== 'ObjectExpression') return;
  const found = new Set();
  for (const property of node.properties) {
    if (property.type !== 'ObjectProperty' || property.key.type !== 'StringLiteral') continue;
    const key = property.key.value;
    if (found.has(key)) fail(`${file}: duplicate key ${JSON.stringify(path + key)} at line ${property.loc.start.line}`);
    found.add(key);
    checkDuplicates(property.value, file, `${path}${key}.`);
  }
}

function readCatalog(locale) {
  const file = `${locale}.json`;
  const text = readFileSync(join(catalogDir, file), 'utf8');
  let data;
  try { data = JSON.parse(text); } catch (error) { throw new Error(`${file}: ${error.message}`); }
  checkDuplicates(parseExpression(text), file);
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error(`${file}: expected a JSON object`);
  if (!process.argv.includes('--sync') && JSON.stringify(data) !== JSON.stringify(sorted(data))) fail(`${file}: keys are not sorted; run npm run i18n:sync`);
  return data;
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|d)\.ts$/.test(entry.name) ? [path] : [];
  });
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if (typeof node.type === 'string') visit(node);
  for (const [key, child] of Object.entries(node)) if (key !== 'loc' && key !== 'extra' && key !== 'errors' && key !== 'tokens' && typeof child === 'object') walk(child, visit);
}

const catalogs = Object.fromEntries(locales.map((locale) => [locale, readCatalog(locale)]));
const en = catalogs.en;
const ru = catalogs.ru;

if (process.argv.includes('--sync')) {
  if (failures.length) {
    for (const failure of failures) process.stderr.write(`${failure}\n`);
    process.exit(1);
  }
  for (const [key, value] of Object.entries(ru)) if (!(key in en) && typeof value !== 'string') fail(`en.json: add English plural forms for ${JSON.stringify(key)} before syncing`);
  if (failures.length) {
    for (const failure of failures) process.stderr.write(`${failure}\n`);
    process.exit(1);
  }
  for (const key of Object.keys(ru)) if (!(key in en)) en[key] = key.replace(context, '');
  for (const locale of locales) writeFileSync(join(catalogDir, `${locale}.json`), `${JSON.stringify(sorted(catalogs[locale]), null, 2)}\n`);
}

for (const key of new Set([...Object.keys(en), ...Object.keys(ru)])) {
  if (!(key in en)) { fail(`en.json: missing source for ${JSON.stringify(key)}`); continue; }
  if (!(key in ru)) { fail(`ru.json: missing translation for ${JSON.stringify(key)}`); continue; }
  const source = key.replace(context, '');
  const english = en[key];
  const russian = ru[key];
  if (typeof english === 'string' && english !== source) fail(`en.json: ${JSON.stringify(key)} must use its English source as the value`);
  if (typeof english !== typeof russian) fail(`${JSON.stringify(key)}: source and translation must both be strings or plural objects`);
  for (const [locale, value] of [['en', english], ['ru', russian]]) {
    if (typeof value === 'string') {
      if (!value.trim()) fail(`${locale}.json: ${JSON.stringify(key)} is empty`);
      if (placeholders(value) !== placeholders(source)) fail(`${locale}.json: ${JSON.stringify(key)} has different placeholders`);
      continue;
    }
    if (!value || Array.isArray(value) || typeof value !== 'object') { fail(`${locale}.json: ${JSON.stringify(key)} must be text or plural forms`); continue; }
    if (Object.keys(value).sort().join(',') !== [...requiredForms[locale]].sort().join(',')) fail(`${locale}.json: ${JSON.stringify(key)} needs ${requiredForms[locale].join('/')} forms`);
    if (!source.includes('{count}')) fail(`${locale}.json: ${JSON.stringify(key)} has plural forms without {count}`);
    for (const [form, text] of Object.entries(value)) {
      if (typeof text !== 'string' || !text.trim() || placeholders(text) !== placeholders(source)) fail(`${locale}.json: ${JSON.stringify(key)} ${form} is empty or has different placeholders`);
    }
  }
  if (typeof english === 'object' && english?.other !== source) fail(`en.json: ${JSON.stringify(key)} other form must match its source`);
}

const literals = new Set();
for (const file of sourceFiles(sourceDir)) {
  const path = relative(fileURLToPath(root), file);
  const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  walk(ast, (node) => {
    if (node.type === 'StringLiteral') literals.add(node.value);
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || !['t', 'tx', 'translate'].includes(node.callee.name)) return;
    const argument = node.arguments[0];
    if (argument?.type === 'StringLiteral' && !(argument.value in en)) fail(`${path}:${argument.loc.start.line}: ${node.callee.name}(${JSON.stringify(argument.value)}) is missing from catalogs`);
  });
}
for (const key of Object.keys(en)) if (!literals.has(key) && !DYNAMIC_MESSAGES.has(key)) fail(`catalogs: unused message ${JSON.stringify(key)}`);

if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`i18n: ${Object.keys(en).length} messages checked in ${locales.join(', ')} catalogs\n`);
}
