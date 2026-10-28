import test from 'node:test';
import assert from 'node:assert/strict';
import en from '../src/i18n/en.js';
import { LANGUAGES, t } from '../src/i18n/index.js';

test('i18n: t() returns the English text, the key when missing, and fills {vars}', () => {
  assert.equal(t('nav.home'), 'Home');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(t('x {n} y', { n: 3 }), 'x 3 y');
});

test('i18n: every language only uses keys that exist in English', () => {
  for (const [code, { messages }] of Object.entries(LANGUAGES)) {
    for (const key of Object.keys(messages)) assert.ok(key in en, `${code}: ${key}`);
  }
});
