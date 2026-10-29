/**
 * Running step targets: speed from the resolved pace (m/s), HR caps and HR
 * targets from the zones, and the step's label and relative intensity.
 */
import { paceZoneOf, hrTargetRange, hrZoneOf, DEFAULT_PACE_PCT } from '../physiology/zones.js';
import { formatPace } from './format.js';

const MS_TO_KMH = 3.6;

/** With HR targets, only steps this long follow an HR zone: HR needs 1–2 min to respond. */
export const HR_STEP_MIN_S = 300;
/** Seconds an HR-zone step leaves speed alone while HR climbs (Z3 and above). */
const HR_SETTLE_S = 150;

/** Picks the target speed within the range: 'low' | 'mid' | 'high'. */
function pickSpeed(pace, position) {
  if (!pace) return null;
  if (pace.value != null && pace.start == null) return pace.value * MS_TO_KMH;
  const lo = Math.min(pace.start, pace.end) * MS_TO_KMH;
  const hi = Math.max(pace.start, pace.end) * MS_TO_KMH;
  if (position === 'low') return lo;
  if (position === 'high') return hi;
  return (lo + hi) / 2;
}

/** Middle of a default pace zone, in % of threshold (Z1 ≈ 70 %). */
function zonePct(z) {
  const i = Math.min(DEFAULT_PACE_PCT.length, Math.max(1, Math.round(z))) - 1;
  const lo = i ? DEFAULT_PACE_PCT[i - 1] : 62;
  const hi = DEFAULT_PACE_PCT[i] >= 500 ? lo + 8 : DEFAULT_PACE_PCT[i];
  return (lo + hi) / 2;
}

/**
 * Relative intensity of a pace or HR target in % of threshold, [start, end].
 * Needs no profile: it draws the workout's shape before steps have a speed.
 */
export function paceIntensity(step) {
  const t = step.pace || step.hr;
  if (!t) return null;
  const a = t.start ?? t.value;
  const b = t.end ?? t.value;
  if (a == null) return null;
  if (t.units === '%pace') return [a, b];
  if (t.units === 'pace_zone' || t.units === 'hr_zone') return [zonePct(a), zonePct(b)];
  // HR in % of LTHR or max HR: rough approximation, only for the shape
  if (t.units === '%lthr') return [a, b];
  if (t.units === '%hr') return [a * 1.1, b * 1.1];
  return null;
}

function describePace(pace) {
  if (!pace) return '';
  if (pace.units === 'pace_zone') return `Z${pace.value} pace`;
  if (pace.units === '%pace') {
    return pace.start != null ? `${pace.start}–${pace.end}% pace` : `${pace.value}% pace`;
  }
  return '';
}

/**
 * Speed (km/h, not limited to any treadmill), HR range, zone, label and
 * intensity of a running step. See flattenWorkout in steps.js for the HR modes.
 */
export function runTargets(step, { position = 'mid', zones = null, hrTargets = false } = {}) {
  const pace = step._pace;
  let speedStart = null;
  let speedEnd = null;
  if (pace && step.ramp && pace.start != null) {
    speedStart = pace.start * MS_TO_KMH;
    speedEnd = pace.end * MS_TO_KMH;
  } else {
    speedStart = speedEnd = pickSpeed(pace, position);
  }

  let hr = null;
  let hrLabel = '';
  let zone = null;
  const hrRange = hrTargetRange(zones, step.hr, step._hr);
  if (hrRange) {
    // lockSpeed: HR is only the step's goal; speed is left alone
    const byIncline = step.hrBy === 'incline' && !step.lockSpeed;
    hr = { ...hrRange, mode: step.lockSpeed ? 'info' : 'target', ...(byIncline && { by: 'incline' }) };
    const z = hrZoneOf(zones, Math.round((hrRange.lo + hrRange.hi) / 2));
    zone = z;
    hrLabel = step.lockSpeed
      ? `HR goal ${z ? `Z${z}` : `${hrRange.lo}–${hrRange.hi}`}`
      : `HR ${hrRange.lo}–${hrRange.hi}${z ? ` (Z${z})` : ''}${byIncline ? ' by incline' : ''}`;
    if (speedStart == null) {
      // Starting speed: the pace zone in the same position
      const pz = z && zones.pace[Math.min(z, zones.pace.length) - 1];
      if (pz) {
        const hi = Number.isFinite(pz.hi) ? pz.hi : pz.lo * 1.05;
        speedStart = speedEnd = pickSpeed({ start: Math.max(pz.lo, 6) / MS_TO_KMH, end: hi / MS_TO_KMH }, position);
      }
    }
  } else if (speedStart != null && zones?.hr.length) {
    const pz = paceZoneOf(zones, Math.max(speedStart, speedEnd));
    zone = pz;
    const hz = zones.hr[Math.min(pz, zones.hr.length) - 1];
    const edge = step.warmup || step.cooldown;
    if (!hz || step.lockSpeed) hr = null;
    else if (!hrTargets || edge) hr = { lo: hz.lo, hi: hz.hi, mode: 'cap' };
    else if (pz <= 4 && (step.duration || 0) >= HR_STEP_MIN_S) {
      hr = { lo: hz.lo, hi: hz.hi, mode: 'target', ...(pz >= 3 && { settle: HR_SETTLE_S }) };
      hrLabel = `HR ${hz.lo}–${hz.hi} (Z${pz})`;
    }
  }

  const label = hrLabel || describePace(step.pace) ||
    (speedStart != null ? `pace ${formatPace(speedStart)}/km` : step.hr ? 'HR target' : 'free');
  return { speedStart, speedEnd, hr, zone, label, intensity: paceIntensity(step) };
}
