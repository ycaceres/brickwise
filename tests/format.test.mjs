import test from 'node:test';
import assert from 'node:assert/strict';
import { initials, athleteMeta, wellnessStats } from '../src/ui/format.js';

test('format: initials and athlete meta', () => {
  assert.equal(initials('Ana María López'), 'AM');
  assert.equal(initials('Intervals.icu'), 'I');
  assert.equal(athleteMeta({ id: 'i1', city: 'Madrid', country: 'Spain' }), 'i1 · Madrid, Spain');
  assert.equal(athleteMeta({ id: 'i1' }), 'i1');
  assert.equal(athleteMeta(null), '');
});

test('format: wellness stats in order, wellness over athlete, missing as null', () => {
  const stats = wellnessStats({
    weight: { value: 71.25, date: '2026-10-28' },
    sleepSecs: { value: 27000, date: '2026-10-28' },
    sleepScore: { value: 82 },
    hrv: { value: 61.6, date: '2026-10-27' },
  }, { weight: 80, restingHr: 48 });
  assert.deepEqual(stats.map((s) => s.label), ['Weight', 'Sleep', 'Resting HR', 'HRV']);
  assert.deepEqual(stats.map((s) => s.value), ['71.3', '7:30', 48, 62]);
  assert.equal(stats[1].unit, 'h · score 82');
  assert.deepEqual(wellnessStats(null, null).map((s) => s.value), [null, null, null, null]);
});
