// Session export
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTcx } from '../tcx.js';

test('buildTcx', () => {
  const t0 = Date.UTC(2026, 9, 25, 12, 0, 0);
  const samples = Array.from({ length: 61 }, (_, i) => ({ t: t0 + i * 1000, distance: i * 2.5, speed: 9, hr: i ? 140 : null }));
  const tcx = buildTcx(samples, { name: 'Test <A&B>' });
  assert.match(tcx, /<Activity Sport="Running">/);
  assert.match(tcx, /<TotalTimeSeconds>60<\/TotalTimeSeconds>/);
  assert.match(tcx, /<DistanceMeters>150\.0<\/DistanceMeters>/);
  assert.match(tcx, /<AverageHeartRateBpm><Value>140<\/Value>/);
  assert.match(tcx, /Test &lt;A&amp;B&gt;/);
  assert.equal((tcx.match(/<Trackpoint>/g) || []).length, 61);
  assert.throws(() => buildTcx([]));
});
