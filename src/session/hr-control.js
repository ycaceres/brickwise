/**
 * Speed adjustment by heart rate: the decision, without timing or state.
 *
 * - It looks ahead: while HR climbs it is projected LEAD_S seconds with its
 *   recent slope, so speed drops before HR crosses the limit. A falling HR is
 *   not projected: a short dip must not ask for more speed (#10).
 * - Steps with an HR target aim at the middle of the range, or lower on
 *   aerobic steps (AEROBIC_AIM), not at its top.
 * - The correction is proportional to how far off HR is (GAIN km/h per bpm,
 *   between MIN_STEP and MAX_STEP). Rises are smaller (MAX_RISE) and never
 *   happen while HR is still climbing: HR lags 1–2 min behind speed (#10).
 * - Steps that follow HR by incline use the same decision, turned into
 *   incline by inclineStep().
 * - α1 guard: on aerobic steps (Z1–Z2), a sustained α1 below VT1 means the
 *   effort is above the aerobic threshold even if HR is still in its zone,
 *   so speed drops and never rises. Not in the warm-up nor with HR in Z1,
 *   where α1 is not in steady state (#10).
 */

import { VT1 } from '../physiology/hrv.js';

export const LEAD_S = 30;        // how far ahead HR is projected
export const SLOPE_WINDOW_S = 30; // samples used for the HR slope (20 s was too noisy, #10)
export const AEROBIC_AIM = 0.4;  // HR-target steps in Z1–Z2 aim at 40 % of the range (VT1 sits near the middle of Z2, #10)
const DEADBAND = 3;              // bpm around the aim of the range that count as on target
const GAIN = 0.1;                // km/h per bpm off target
const MIN_STEP = 0.1;
const MAX_STEP = 0.5;
const MAX_RISE = 0.2;            // km/h per rise: going up overshoots, going down does not (#10)
const RISING = 0.05;             // bpm/s (3 bpm/min): HR still climbing, so no rise yet
const ALPHA_STEP = 0.2;          // km/h per α1 correction
const CAP_MARGIN = 5;            // pace steps give speed back once HR is this far below the cap
const INCLINE_STEP = 0.5;        // % per incline correction (the treadmill's resolution)

const round1 = (v) => Math.round(v * 10) / 10;
const stepFor = (bpm) => round1(Math.min(MAX_STEP, Math.max(MIN_STEP, GAIN * bpm)));
const riseFor = (bpm) => Math.min(MAX_RISE, stepFor(bpm));

/** HR slope (bpm/s) by least squares over `samples` ({elapsed, hr}). */
export function hrSlope(samples) {
  const pts = samples.filter((s) => s.hr > 0);
  if (pts.length < 5) return 0;
  const n = pts.length;
  const mx = pts.reduce((a, s) => a + s.elapsed, 0) / n;
  const my = pts.reduce((a, s) => a + s.hr, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of pts) {
    num += (s.elapsed - mx) * (s.hr - my);
    den += (s.elapsed - mx) ** 2;
  }
  return den ? num / den : 0;
}

/**
 * Speed change (km/h) the HR asks for right now; 0 = leave it.
 * @param {{mode: 'cap'|'target', lo: number, hi: number, hr: number, slope: number,
 *          hrAdjust: number, alphaLow: boolean, aim?: number}} p
 *   hrAdjust: km/h already removed (< 0) or added (> 0) in this step.
 *   alphaLow: α1 has been below VT1 long enough on an aerobic step.
 *   aim: where in the range an HR target aims (0 = bottom, 0.5 = middle).
 * @returns {{delta: number, reason: string}}
 */
export function hrDecision({ mode, lo, hi, hr, slope, hrAdjust, alphaLow, aim = 0.5 }) {
  const projected = hr + Math.max(0, slope) * LEAD_S;
  const climbing = slope > RISING;
  let delta = 0;
  let reason = '';

  if (mode === 'target') {
    const goal = lo + (hi - lo) * aim;
    const off = projected - goal;
    if (off > DEADBAND) {
      delta = -stepFor(off - DEADBAND);
      reason = `HR → ${Math.round(projected)}, aiming at ${Math.round(goal)}`;
    } else if (off < -DEADBAND && !alphaLow && !climbing) {
      delta = riseFor(-off - DEADBAND);
      reason = `HR → ${Math.round(projected)}, aiming at ${Math.round(goal)}`;
    }
  } else if (mode === 'cap') {
    if (projected > hi) {
      delta = -stepFor(projected - hi);
      reason = `HR → ${Math.round(projected)}, cap ${hi}`;
    } else if (hrAdjust < 0 && hr < hi - CAP_MARGIN && slope <= 0 && !alphaLow) {
      delta = Math.min(-hrAdjust, riseFor(hi - CAP_MARGIN - hr));
      reason = `HR ${hr} back under cap ${hi}`;
    }
  }

  if (alphaLow && delta >= 0) {
    delta = -ALPHA_STEP;
    reason = `α1 below ${VT1} with HR ${hr}`;
  }
  return { delta: round1(delta), reason };
}

/**
 * Whether the α1 guard may act on a step: aerobic (Z1–Z2), not the warm-up,
 * and HR above Z1. Early in exercise and at easy effort α1 is not in steady
 * state and reads low (2026-10-28: 0.52–0.70 at 114–117 bpm, 0.83 later at
 * 142 bpm), which slowed a warm-up for nothing (#10).
 */
export function alphaGuardApplies({ zone, warmup, hr, z1Top }) {
  return zone != null && zone <= 2 && !warmup && !(z1Top && hr <= z1Top);
}

/**
 * The same correction on the incline (steps with hr.by = 'incline'): walking,
 * 1 % weighs about as much as 0.9 km/h, so small corrections move 0.5 % and
 * big ones (over 0.25 km/h) 1 %.
 */
export function inclineStep(kmh) {
  if (!kmh) return 0;
  return Math.sign(kmh) * (Math.abs(kmh) > 0.25 ? 2 * INCLINE_STEP : INCLINE_STEP);
}
