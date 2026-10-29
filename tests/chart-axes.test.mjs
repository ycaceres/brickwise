import test from 'node:test';
import assert from 'node:assert/strict';
import { niceTicks, paceAxis, powerAxis, leftAxisFor } from '../src/ui/chart-axes.js';

test('chart axes: power for bike workouts with cycling zones, pace otherwise', () => {
  const ride = [{ power: { lo: 100, hi: 150 } }];
  assert.equal(leftAxisFor({ power: [{ hi: 100 }] }, ride), powerAxis);
  assert.equal(leftAxisFor(null, ride), paceAxis);
  assert.equal(leftAxisFor({ power: [{ hi: 100 }] }, [{ speedStart: 9 }]), paceAxis);
});

test('chart axes: domains', () => {
  const plan = [{ speedStart: 7, speedEnd: 8 }, { speedStart: 10, speedEnd: 10 }];
  assert.deepEqual(paceAxis.domain({ plan, samples: [{ speed: 1 }], floor: 0.9 }), { lo: 7 * 0.9, hi: 10 * 1.08 });
  assert.deepEqual(paceAxis.domain({ plan: [], samples: [], floor: 0.9 }), { lo: 3, hi: 6 * 1.08 });
  const w = powerAxis.domain({ plan: [{ power: { lo: 100, hi: 150 } }, { power: { lo: 200, hi: 200 } }], hrLeft: [250], floor: 0.5 });
  assert.equal(w.lo, 50);
  assert.equal(w.hi, 250 * 1.08);
});

test('chart axes: block heights, ticks and tooltip rows', () => {
  assert.deepEqual(powerAxis.blockValues({ power: { lo: 100, hi: 140 } }), [120, 120]);
  assert.deepEqual(powerAxis.blockValues({ power: { lo: 100, hi: 140 }, ramp: true }), [100, 140]);
  assert.deepEqual(paceAxis.blockValues({ speedStart: 7, speedEnd: 8 }), [7, 8]);
  assert.equal(paceAxis.blockValues({ speedStart: null }), null);
  const y = (v) => 300 - v; // 1 px per unit
  assert.deepEqual(powerAxis.ticks({ lo: 0, hi: 280 }, y, { top: 0, bottom: 300 }).map((t) => t.label), ['100', '200']);
  const pace = paceAxis.ticks({ lo: 6, hi: 13 }, (v) => 300 - v * 20, { top: 0 }).map((t) => t.label);
  assert.ok(pace.includes('5:00') && pace.every((l) => /^\d+:\d\d$/.test(l)));
  assert.deepEqual(niceTicks(0, 280, 4).ticks, [0, 100, 200]);
  assert.deepEqual(powerAxis.planRows({ power: { lo: 172, hi: 200 }, zone: 4, hr: { lo: 154, hi: 162, mode: 'info' } }), [[null, '172–200 W', 'target Z4'], [null, '154–162 bpm', 'HR goal']]);
  assert.equal(powerAxis.planRows({ speedStart: 9 }), null);
  assert.deepEqual(paceAxis.planRows({ speedStart: 9, speedEnd: 9, zone: 3, incline: 1, hr: { lo: 0, hi: 150, mode: 'cap' } }), [[null, '6:40/km', 'target Z3 · 1 %'], [null, '≤ 150 bpm', 'HR cap']]);
  assert.equal(powerAxis.unit(), 'W');
  assert.equal(paceAxis.unit({}), 'min/km');
  assert.equal(paceAxis.chip({ speed: 9 }, { pace: [{ z: 1, lo: 0, hi: 8 }, { z: 2, lo: 8, hi: 12 }] }), 2);
});
