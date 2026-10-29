import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import en from '../src/i18n/en.js';
import { LANGUAGES, t, placeholders, missingKeys } from '../src/i18n/index.js';
import { formatNumber, formatDate } from '../src/i18n/format.js';
import { PAGE_FILES } from '../src/lib/pages.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const dictionaries = async () => Promise.all(LANGUAGES.map(async (l) => [l.code, (await l.load()).default]));

test('i18n: t() returns English, the key when missing, and fills {vars}', () => {
  assert.equal(t('nav.home'), 'Home');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(t('x {n} y', { n: 3 }), 'x 3 y');
});

test('i18n: every data-i18n key in the page exists in English', () => {
  const html = [read('../index.html'), ...PAGE_FILES.map((n) => read(`../pages/${n}.html`))].join('\n');
  const keys = [...html.matchAll(/data-i18n(?:-label|-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 0);
  for (const k of keys) assert.ok(k in en, `missing in en.js: ${k}`);
});

test('i18n: every t(\'…\') key used in the code exists in English', () => {
  const files = fs.readdirSync(new URL('../src/', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    for (const [, k] of read(`../src/${f}`).matchAll(/\bt\('([a-z][\w.-]*)'/g)) assert.ok(k in en, `${f}: ${k}`);
  }
});

test('i18n: languages only use English keys, with the same placeholders and all plural forms', async () => {
  for (const [code, dict] of await dictionaries()) {
    const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    for (const [key, msg] of Object.entries(dict)) {
      assert.ok(key in en, `${code}: ${key} is not an English key`);
      assert.deepEqual(placeholders(msg), placeholders(en[key]), `${code}: placeholders of ${key}`);
      if (typeof msg === 'object') for (const f of forms) if (f !== 'many') assert.ok(f in msg || 'other' in msg, `${code}: ${key} lacks ${f}`);
    }
    const missing = missingKeys(dict);
    if (missing.length) console.warn(`i18n: ${code} misses ${missing.length} keys (English shows instead)`);
  }
});

test('i18n: plural messages follow the language rules', () => {
  en['test.steps'] = { one: '{n} step', other: '{n} steps' };
  try {
    assert.equal(t('test.steps', { n: 1 }), '1 step');
    assert.equal(t('test.steps', { n: 7 }), '7 steps');
    assert.equal(t('test.steps'), '{n} steps');
  } finally {
    delete en['test.steps'];
  }
  assert.deepEqual(placeholders({ one: '{n} step', other: '{n} steps of {name}' }), ['n', 'name']);
});

test('i18n: numbers and dates in the language', () => {
  assert.equal(formatNumber(7.5, { decimals: 1 }), '7.5');
  assert.equal(formatNumber(7.5, { decimals: 1, lang: 'es' }), '7,5');
  assert.equal(formatNumber(7.5, { decimals: 1, lang: 'fr' }), '7,5');
  assert.equal(formatDate('2026-10-28T12:00:00', { lang: 'es' }), '28/10/26');
  assert.match(formatDate('2026-10-28T12:00:00'), /10\/28\/26/);
});
