import test from 'node:test';
import assert from 'node:assert/strict';
import { addTest, loadTests, testText, TESTS_KEPT } from '../src/session/test-history.js';

test('test history: newest first, at most TESTS_KEPT', () => {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  try {
    for (let i = 0; i < TESTS_KEPT + 3; i++) addTest({ vt1: { hr: 140 + i, kmh: 9 } }, new Date(Date.UTC(2026, 0, i + 1)));
    const tests = loadTests();
    assert.equal(tests.length, TESTS_KEPT);
    assert.equal(tests[0].vt1.hr, 140 + TESTS_KEPT + 2);
    assert.ok(tests[0].date > tests[1].date);
  } finally {
    delete globalThis.localStorage;
  }
});

test('test history: how a result reads', () => {
  assert.equal(testText({ vt1: { hr: 140, kmh: 9 }, vt2: { hr: 165, kmh: 10.5, extrapolated: true } }), 'VT1 140 bpm at 6:40/km · VT2 165 bpm at 5:43/km (extrapolated)');
  assert.equal(testText({ vt1: { hr: 140, kmh: 9 }, vt2: null }), 'VT1 140 bpm at 6:40/km · VT2 not reached');
});
