// Speed and incline adjustment by HR
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hrDecision, hrSlope } from '../src/session/hr-control.js';

test('HR control: aims at the middle, looks ahead, scales the correction', () => {
  const z2 = { mode: 'target', lo: 135, hi: 160, hrAdjust: 0, alphaLow: false };
  // Steady at 158 with Z2 135–160: above the middle (147.5), so it slows down by the max step
  assert.deepEqual(hrDecision({ ...z2, hr: 158, slope: 0 }).delta, -0.5);
  // On target, nothing
  assert.equal(hrDecision({ ...z2, hr: 148, slope: 0 }).delta, 0);
  // Still on target but climbing 0.2 bpm/s → projected 154 in 30 s: slow down a little already
  assert.equal(hrDecision({ ...z2, hr: 148, slope: 0.2 }).delta, -0.4);
  // Below the range: speed up
  assert.ok(hrDecision({ ...z2, hr: 138, slope: 0 }).delta > 0);
});

test('HR control: pace steps cap HR ahead of time and give the speed back', () => {
  const cap = { mode: 'cap', lo: 135, hi: 160, alphaLow: false };
  assert.equal(hrDecision({ ...cap, hr: 155, slope: 0, hrAdjust: 0 }).delta, 0);
  assert.ok(hrDecision({ ...cap, hr: 157, slope: 0.2, hrAdjust: 0 }).delta < 0);   // heading to 163
  assert.equal(hrDecision({ ...cap, hr: 150, slope: 0, hrAdjust: -0.4 }).delta, 0.4);
  assert.equal(hrDecision({ ...cap, hr: 150, slope: 0.1, hrAdjust: -0.4 }).delta, 0); // still rising
});

test('HR control: α1 below VT1 slows aerobic steps even with HR in range', () => {
  const p = { mode: 'target', lo: 135, hi: 160, hr: 147, slope: 0, hrAdjust: 0 };
  assert.equal(hrDecision({ ...p, alphaLow: false }).delta, 0);
  assert.equal(hrDecision({ ...p, alphaLow: true }).delta, -0.2);
  assert.equal(hrDecision({ ...p, hr: 130, alphaLow: true }).delta, -0.2);       // never speeds up
  assert.equal(hrDecision({ ...p, hr: 160, alphaLow: true }).delta, -0.5);       // HR correction is bigger
  assert.equal(hrSlope([1, 2, 3, 4, 5, 6].map((i) => ({ elapsed: i, hr: 140 + i }))), 1);
  assert.equal(hrSlope([{ elapsed: 1, hr: 140 }]), 0);
});
