// Whole sessions in Node with a fake clock: steps, stale data, and the HR
// control rules tuned in #10 (spacing, limits, no rise while climbing, α1 guard).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSession, runStep } from './session/harness.mjs';
import { parseSessionCsv, replay } from './session/replay.mjs';
import { samplesToCsv } from '../src/export/csv.js';
import { live } from '../src/session/live.js';

const Z2 = { lo: 135, hi: 150, mode: 'target' };   // Z2 of the fixture profile; Z1 tops at 134
const gaps = (list) => list.slice(1).map((x, i) => x.at - list[i].at);

test('flow: skip moves on, stale data counts no distance and pauses', () => {
  const h = startSession({ steps: [runStep({ speedStart: 8, speedEnd: 8 }), runStep({ speedStart: 10, speedEnd: 10 })] });
  h.run(10, { speed: 8 });
  assert.equal(h.session.state, 'running');
  h.runner.applyStep(1);                         // what Skip does
  assert.equal(h.session.stepIdx, 1);
  assert.equal(h.speeds().at(-1).speed, 10);
  const dist = h.session.totalDist;
  h.stale(4, { speed: 10 });                     // the device stopped reporting
  assert.ok(h.session.totalDist - dist < 10, 'no distance once readings are stale');
  h.stale(3, { speed: 10 });
  assert.equal(h.session.state, 'paused');
});

test('flow: HR above the target drops speed after the grace, spaced, at most −2 km/h', () => {
  const h = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
  h.run(54, { hr: 160 });
  assert.equal(h.speeds().length, 1, 'nothing before 45 s grace + 10 s hold');
  h.run(400, { hr: 160 });
  const drops = h.speeds().slice(1);
  assert.ok(drops.length >= 2);
  assert.ok(drops[0].at >= 55);
  assert.ok(gaps(drops).every((g) => g >= 25), `spacing ${gaps(drops)}`);
  assert.ok(drops.every((d, i) => d.speed < (i ? drops[i - 1].speed : 9)));
  assert.equal(Math.min(...drops.map((d) => d.speed)), 7);   // 9 − 2.0
});

test('flow: HR below the target rises by at most 0.2 km/h, 60 s apart, up to +1.5', () => {
  const h = startSession({ steps: [runStep({ hr: Z2, duration: 1200 })], hrOn: true });
  h.run(1100, { hr: 125 });
  const rises = h.speeds().slice(1);
  assert.ok(rises.length >= 5);
  assert.ok(gaps(rises).every((g) => g >= 60), `spacing ${gaps(rises)}`);
  assert.ok(rises.every((r, i) => Math.round((r.speed - (i ? rises[i - 1].speed : 9)) * 10) / 10 <= 0.2));
  assert.equal(Math.max(...rises.map((r) => r.speed)), 10.5); // 9 + 1.5
});

test('flow: no rise while HR is still climbing', () => {
  const h = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
  h.run(150, { hr: (t) => 110 + 0.1 * t });     // under the aim, but rising 6 bpm/min
  assert.equal(h.speeds().length, 1);
});

test('flow: α1 guard slows an aerobic step after 120 s + 60 s of low α1, but not in the warm-up or under Z1', () => {
  const aerobic = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
  aerobic.run(175, { hr: 141, alpha1: 0.6 });   // HR on the aim (40 % of Z2): only α1 can move it
  assert.equal(aerobic.speeds().length, 1);
  aerobic.run(30, { hr: 141, alpha1: 0.6 });
  const drop = aerobic.speeds()[1];
  assert.ok(drop && drop.at >= 180, 'drop after ALPHA_MIN_S + ALPHA_HOLD_S');
  assert.equal(drop.speed, 8.8);

  const warmup = startSession({ steps: [runStep({ hr: { ...Z2, mode: 'cap' }, warmup: true })], hrOn: true });
  warmup.run(300, { hr: 141, alpha1: 0.6 });
  assert.equal(warmup.speeds().length, 1, 'no α1 drop in the warm-up');

  const underZ1 = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
  underZ1.run(300, { hr: (t) => (t < 60 ? 125 : 132), alpha1: 0.6 });
  assert.ok(underZ1.speeds().every((s) => s.speed >= 9), 'no α1 drop with HR under the top of Z1');
});

test('flow: a warm-up ramp ends once HR holds the top of Z1', () => {
  const h = startSession({ steps: [
    runStep({ label: 'Warm-up', warmup: true, ramp: true, speedStart: 7, speedEnd: 8, zone: 1 }),
    runStep({ label: 'Z2', speedStart: 9, speedEnd: 9, zone: 2 }),
  ] });
  h.run(20, { hr: 120 });
  assert.equal(h.session.stepIdx, 0);
  h.run(8, { hr: 136 });
  assert.equal(h.session.stepIdx, 1);
});

test('flow (#10): a short HR dip does not justify a rise; a long one does', () => {
  // Replayed through Brickwise's own CSV export
  const series = (dip) => Array.from({ length: 260 }, (_, s) => ({
    elapsed: s, distance: s * 2.5, speed: 9, incline: 1,
    hr: s >= 200 && s < 200 + dip ? 137 : 142,
  }));
  for (const [dip, rises] of [[8, 0], [15, 1]]) {
    const h = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
    replay(h, parseSessionCsv(samplesToCsv(series(dip))));
    const sp = h.speeds();
    const up = sp.filter((x, i) => i && x.speed > sp[i - 1].speed).length;
    assert.equal(up, rises, `dip of ${dip} s: ${JSON.stringify(sp)}`);
  }
});

test('flow: the real treadmill simulator drives a session', async () => {
  const { getDriver } = await import('../src/devices/registry.js');
  const h = startSession({ steps: [runStep({ speedStart: 8, speedEnd: 8 })] });
  const sim = getDriver('simulated-treadmill').create({
    onData: (s) => { live.speed = s.speed; live.incline = s.incline; },
  });
  sim.running = true;          // no connect(): no timers, ticks below
  h.device.setTarget = (t) => sim.setTarget(t);
  const tickBoth = (n) => { for (let i = 0; i < n; i++) { sim._tick(1); h.device.state.updatedAt = Date.now(); h.run(1, { speed: live.speed }); } };
  sim.simulate({ belt: 'toggle' });
  tickBoth(8);
  assert.equal(h.session.state, 'running');
  assert.equal(sim.target.speed, 8);
  sim.simulate({ belt: 'toggle' });
  tickBoth(12);
  assert.equal(h.session.state, 'paused');
});

test('csv: ride samples (no incline) export', () => {
  const csv = samplesToCsv([{ elapsed: 1, distance: 8, speed: 30, power: 200, cadence: 90, hr: 120, target: 200 }]);
  assert.match(csv.split('\n')[1], /^1,30\.00,2:00,200,,120,8\.0,,$/);
});
