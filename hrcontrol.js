/**
 * Speed adjustment by heart rate: the decision, without timing or state.
 *
 * - It looks ahead: HR is projected LEAD_S seconds with its recent slope, so
 *   speed drops while HR is still climbing towards the limit instead of
 *   after it crossed it.
 * - Steps with an HR target aim at the middle of the range, not at its top.
 * - The correction is proportional to how far off HR is (GAIN km/h per bpm,
 *   between MIN_STEP and MAX_STEP).
 * - α1 guard: on aerobic steps (Z1–Z2), a sustained α1 below VT1 means the
 *   effort is above the aerobic threshold even if HR is still in its zone,
 *   so speed drops and never rises.
 */

import { VT1 } from './hrv.js';

export const LEAD_S = 30;        // how far ahead HR is projected
export const SLOPE_WINDOW_S = 20; // samples used for the HR slope
const DEADBAND = 3;              // bpm around the middle of the range that count as on target
const GAIN = 0.1;                // km/h per bpm off target
const MIN_STEP = 0.1;
const MAX_STEP = 0.5;
const ALPHA_STEP = 0.2;          // km/h per α1 correction
const CAP_MARGIN = 5;            // pace steps give speed back once HR is this far below the cap

const round1 = (v) => Math.round(v * 10) / 10;
const stepFor = (bpm) => round1(Math.min(MAX_STEP, Math.max(MIN_STEP, GAIN * bpm)));

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
 *          hrAdjust: number, alphaLow: boolean}} p
 *   hrAdjust: km/h already removed (< 0) or added (> 0) in this step.
 *   alphaLow: α1 has been below VT1 long enough on an aerobic step.
 * @returns {{delta: number, reason: string}}
 */
export function hrDecision({ mode, lo, hi, hr, slope, hrAdjust, alphaLow }) {
  const projected = hr + slope * LEAD_S;
  let delta = 0;
  let reason = '';

  if (mode === 'target') {
    const mid = (lo + hi) / 2;
    const off = projected - mid;
    if (off > DEADBAND) {
      delta = -stepFor(off - DEADBAND);
      reason = `HR → ${Math.round(projected)}, aiming at ${Math.round(mid)}`;
    } else if (off < -DEADBAND && !alphaLow) {
      delta = stepFor(-off - DEADBAND);
      reason = `HR → ${Math.round(projected)}, aiming at ${Math.round(mid)}`;
    }
  } else if (mode === 'cap') {
    if (projected > hi) {
      delta = -stepFor(projected - hi);
      reason = `HR → ${Math.round(projected)}, cap ${hi}`;
    } else if (hrAdjust < 0 && hr < hi - CAP_MARGIN && slope <= 0 && !alphaLow) {
      delta = Math.min(-hrAdjust, stepFor(hi - CAP_MARGIN - hr));
      reason = `HR ${hr} back under cap ${hi}`;
    }
  }

  if (alphaLow && delta >= 0) {
    delta = -ALPHA_STEP;
    reason = `α1 below ${VT1} with HR ${hr}`;
  }
  return { delta: round1(delta), reason };
}
