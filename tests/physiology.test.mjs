// Zones, DFA α1 and ventilatory thresholds
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paceZoneOf, hrTargetRange, hrZoneOf, zonesFromProfile, profileFromIntervals, resolveDoc } from '../zones.js';
import { cleanRr, dfaAlpha1, alpha1Window, alphaState } from '../hrv.js';
import { analyzeRamp, flatKmh } from '../thresholds.js';
import { flattenWorkout } from '../workout.js';
import { runSettings, LIBRARY } from './fixtures.mjs';

test('zones: HR and pace ranges', () => {
  const z = zonesFromProfile(profileFromIntervals(runSettings));
  assert.deepEqual(z.hr[1], { z: 2, name: 'Z2', lo: 135, hi: 150 });
  assert.equal(z.pace.length, 7);
  assert.equal(z.pace[6].hi, Infinity);
  assert.equal(paceZoneOf(z, 8.0), 2);       // 7.54–8.53 km/h
  assert.equal(paceZoneOf(z, 9.7), 4);       // threshold 9.73 km/h
  assert.equal(paceZoneOf(z, 14), 7);
  assert.equal(hrZoneOf(z, 160), 4);
  assert.deepEqual(hrTargetRange(z, { units: 'hr_zone', value: 2 }), { lo: 135, hi: 150 });
  assert.deepEqual(hrTargetRange(z, { units: '%lthr', start: 80, end: 90 }), { lo: 134, hi: 151 });
  assert.deepEqual(hrTargetRange(z, null, { value: 150 }), { lo: 147, hi: 153 });
});

test('profile: Intervals percentages reproduce its zones and follow LTHR', () => {
  const p = profileFromIntervals(runSettings);
  assert.deepEqual(zonesFromProfile(p).hr.map((z) => z.hi), runSettings.hr_zones);
  const z = zonesFromProfile({ ...p, lthr: 160, maxHr: 180 });
  assert.equal(z.hr[3].hi, 160);            // Z4 ends at LTHR
  assert.equal(z.hr[6].hi, 180);            // the last one reaches max HR
  const est = zonesFromProfile({ ...p, lthr: null, maxHr: 190 });
  assert.equal(est.lthr, 173);              // 91 % of max HR
});

test('α1: artifacts, white noise vs correlated noise', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const white = Array.from({ length: 400 }, () => 800 + (rand() - 0.5) * 60);
  let e = 0;
  const corr = Array.from({ length: 400 }, () => 800 + (e = 0.95 * e + (rand() - 0.5) * 20));
  assert.ok(dfaAlpha1(white) < 0.75, `white ${dfaAlpha1(white)}`);
  assert.ok(dfaAlpha1(corr) > 1, `correlated ${dfaAlpha1(corr)}`);

  const bad = [...white];
  for (let i = 0; i < 25; i++) bad[i * 15] = 400; // split beats (6 %)
  assert.equal(cleanRr(bad).artifacts, 25);

  // Window: above 5 % artifacts there is no value
  const beats = bad.map((rr, i) => ({ t: i * 300, rr }));
  const w = alpha1Window(beats, beats[beats.length - 1].t);
  assert.equal(w.alpha1, null);
  assert.equal(w.reason, 'noisy signal');
  assert.equal(alphaState(0.9), 'aerobic');
  assert.equal(alphaState(0.6), 'transition');
  assert.equal(alphaState(0.4), 'anaerobic');
});

test('threshold test: ramp steps and VT1/VT2 from α1 vs HR', () => {
  const zones = zonesFromProfile({ ...profileFromIntervals(runSettings), thresholdKmh: 10 });
  const steps = flattenWorkout(resolveDoc(LIBRARY.find((w) => w.id === 'alpha-test').workout_doc, zones), { zones });
  const ramp = steps.filter((s) => s.test);
  assert.equal(ramp.length, 17);
  assert.deepEqual(ramp.slice(0, 10).map((s) => s.incline), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(ramp.every((s) => s.hr === null), 'no HR control during the test');
  assert.equal(Math.round(flatKmh(8, 10) * 100) / 100, 11.6);

  // HR climbs 2.5 bpm/min from 115; α1 falls with the mean HR of its 2 min window
  const samples = [];
  for (let t = 0; t <= 1500; t++) {
    const hr = 115 + (2.5 * t) / 60;
    const meanHr = hr - 2.5;                                   // mean of the last 2 min
    samples.push({ elapsed: t, hr, speed: 7.5, incline: Math.min(10, t / 60), alpha1: t % 5 ? null : 1.2 - (meanHr - 120) * 0.015 });
  }
  const r = analyzeRamp(samples, 300, 1500);
  assert.equal(r.vt1.hr, 150);                               // 1.2 − 0.015·30 = 0.75
  assert.equal(r.vt2.hr, 167);
  assert.equal(r.vt2.extrapolated, false);
  assert.ok(r.r2 > 0.99 && r.vt2.kmh > r.vt1.kmh);
  assert.match(analyzeRamp(samples.map((s) => ({ ...s, alpha1: null })), 300, 1500).error, /chest strap/);
  assert.match(analyzeRamp(samples, 300, 500).error, /too early|Not enough/);
});
