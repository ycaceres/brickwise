import test from 'node:test';
import assert from 'node:assert/strict';
import { initials, athleteMeta, wellnessStats, zoneSummary, zoneTable } from '../src/ui/format.js';

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

test('format: zone summary skips what is missing', () => {
  assert.equal(zoneSummary(168, '6:10 min/km', 185), 'LTHR 168 bpm @ 6:10 min/km · max HR 185 bpm');
  assert.equal(zoneSummary(null, '190 W', null), 'Threshold 190 W');
  assert.equal(zoneSummary(null, null, null), '');
});

test('format: zone tables for running and cycling', () => {
  const run = zoneTable('run', {
    hr: [{ lo: 0, hi: 134 }, { lo: 135, hi: 150 }],
    pace: [{ lo: 0, hi: 7.5 }, { lo: 7.5, hi: 8.5 }, { lo: 12, hi: Infinity }],
    lthr: 168, thresholdKmh: 9.73, maxHr: 185,
  });
  assert.deepEqual(run.head, ['Zone', 'HR (bpm)', 'Pace (min/km)']);
  assert.equal(run.rows.length, 3);
  assert.deepEqual(run.rows[0].cells, ['≤ 134', 'slower than 8:00']);
  assert.deepEqual(run.rows[1].cells, ['135–150', '7:04–8:00']);
  assert.deepEqual(run.rows[2].cells, ['—', 'faster than 5:00']);
  assert.equal(run.summary, 'LTHR 168 bpm @ 6:10 min/km · max HR 185 bpm');

  const ride = zoneTable('ride', { hr: [{ lo: 0, hi: 120 }], power: [{ lo: 0, hi: 104, name: 'Recovery' }, { lo: 300, hi: Infinity }], ftp: 190 });
  assert.deepEqual(ride.head, ['Zone', 'HR (bpm)', 'Power (W)']);
  assert.deepEqual(ride.rows.map((r) => r.cells), [['≤ 120', '≤ 104'], ['—', '≥ 300']]);
  assert.equal(ride.rows[0].name, 'Recovery');
  assert.equal(ride.summary, 'Threshold 190 W');

  assert.deepEqual(zoneTable('run', null).rows, []);
});
