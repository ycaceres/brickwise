/**
 * Turns an Intervals.icu workout_doc (fetched with resolve=true) into a flat
 * list of treadmill steps.
 *
 * With resolve=true every step carries `_pace` in m/s ({start, end} for a
 * range or {value} for a fixed value), so the zones are not needed.
 */

import { LIMITS } from '../devices/treadmill/exp5i-protocol.js';
import { paceZoneOf, hrTargetRange, hrZoneOf, DEFAULT_PACE_PCT, DEFAULT_POWER_PCT } from '../physiology/zones.js';

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

const round1 = (v) => Math.round(v * 10) / 10;
const clampSpeed = (v) => Math.min(LIMITS.speedMax, Math.max(LIMITS.speedMin, v));
const clampIncline = (v) => Math.min(LIMITS.inclineMax, Math.max(LIMITS.inclineMin, v));

/** Middle of a default pace zone, in % of threshold (Z1 ≈ 70 %). */
function zonePct(z) {
  const i = Math.min(DEFAULT_PACE_PCT.length, Math.max(1, Math.round(z))) - 1;
  const lo = i ? DEFAULT_PACE_PCT[i - 1] : 62;
  const hi = DEFAULT_PACE_PCT[i] >= 500 ? lo + 8 : DEFAULT_PACE_PCT[i];
  return (lo + hi) / 2;
}

/**
 * Relative step intensity in % of threshold pace, [start, end]. Needs no
 * profile: it draws the workout's shape even before steps have a speed.
 */
function stepIntensity(step) {
  const p = step.power;
  if (p && (p.start ?? p.value) != null) {
    const a = p.start ?? p.value;
    const b = p.end ?? p.value;
    if (p.units === '%ftp') return [a, b];
    if (p.units === 'power_zone') return [powerZonePct(a), powerZonePct(b)];
  }
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

/** Middle of a default power zone, in % of FTP. */
function powerZonePct(z) {
  const i = Math.min(DEFAULT_POWER_PCT.length, Math.max(1, Math.round(z))) - 1;
  const lo = i ? DEFAULT_POWER_PCT[i - 1] : 40;
  const hi = DEFAULT_POWER_PCT[i] >= 500 ? lo + 30 : DEFAULT_POWER_PCT[i];
  return (lo + hi) / 2;
}

/**
 * Power target of a bike step in watts { lo, hi }, from the cycling zones
 * (zones.power, zones.ftp) or, without them, what Intervals.icu resolved.
 */
function powerRange(step, zones) {
  const p = step.power;
  if (!p) return null;
  const a = p.start ?? p.value;
  const b = p.end ?? p.value;
  if (a != null) {
    if (p.units === 'w') return { lo: Math.round(a), hi: Math.round(b) };
    if (p.units === '%ftp' && zones?.ftp) return { lo: Math.round((a / 100) * zones.ftp), hi: Math.round((b / 100) * zones.ftp) };
    if (p.units === 'power_zone' && zones?.power?.length) {
      const zl = zones.power[Math.round(a) - 1];
      const zh = zones.power[Math.round(b) - 1];
      if (zl && zh) return { lo: zl.lo, hi: Number.isFinite(zh.hi) ? zh.hi : Math.round(zh.lo * 1.2) };
    }
  }
  const r = step._power;
  if (r && (r.start ?? r.value) != null) return { lo: Math.round(r.start ?? r.value), hi: Math.round(r.end ?? r.value) };
  return null;
}

/** Power zone (1..n) of a wattage. */
function powerZoneOf(zones, w) {
  if (!zones?.power?.length || w == null) return null;
  const z = zones.power.find((p) => w <= p.hi);
  return z ? z.z : zones.power.length;
}

function describePower(power, watts) {
  if (!power) return '';
  const w = watts ? ` (${watts.lo === watts.hi ? watts.lo : `${watts.lo}–${watts.hi}`} W)` : '';
  if (power.units === 'power_zone') return `Z${power.start != null ? `${power.start}–${power.end}` : power.value} power${w}`;
  if (power.units === '%ftp') return `${power.start != null ? `${power.start}–${power.end}` : power.value}% FTP${w}`;
  return watts ? `${watts.lo === watts.hi ? watts.lo : `${watts.lo}–${watts.hi}`} W` : '';
}

/** Incline written in the step text, e.g. "incline 2%", "2% incl", "inclinación 3". */
function parseIncline(text) {
  if (!text) return null;
  const m =
    text.match(/incl\p{L}*\.?\s*(-?\d+(?:[.,]\d+)?)\s*%?/iu) ||
    text.match(/(-?\d+(?:[.,]\d+)?)\s*%\s*incl/iu);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
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
 * @param {object} doc       resolved workout_doc
 * @param {object} opts      { position: 'low'|'mid'|'high', defaultIncline: number, zones, hrTargets }
 *
 * With zones (physiology/zones.js) every step also carries `hr` = { lo, hi, mode }:
 * - mode 'cap':    step with a pace target; hi is the top of the matching HR
 *                  zone (same position as the pace zone).
 * - mode 'target': step with an HR target; the starting speed comes from the
 *                  matching pace zone and is then adjusted by HR.
 * - mode 'info':   step with lockSpeed; the HR range is only displayed.
 * An HR target with `hrBy: 'incline'` keeps the speed and moves the incline
 * instead (hr.by = 'incline').
 *
 * hrTargets (the workout follows HR): steps of HR_STEP_MIN_S or more in pace
 * Z1–Z4 become 'target' steps on the HR zone with the same index, starting at
 * their pace. Shorter steps (reps, recoveries, strides) keep their pace and get
 * no HR control; warm-up and cooldown keep the cap.
 *
 * @returns {Array<{label, kind, duration, distance, speedStart, speedEnd, incline, hasTarget, hr}>}
 */
export function flattenWorkout(doc, { position = 'mid', defaultIncline = 1, zones = null, hrTargets = false } = {}) {
  const out = [];

  const walk = (steps, path) => {
    steps.forEach((step, i) => {
      if (step.steps && step.steps.length) {
        const reps = step.reps || 1;
        for (let r = 1; r <= reps; r++) {
          walk(step.steps, [...path, reps > 1 ? `${r}/${reps}` : null].filter(Boolean));
        }
        return;
      }

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
      // Bike steps: power target in watts, colored by power zone
      const power = powerRange(step, zones);
      const powerLabel = describePower(step.power, power);
      if (power) zone = powerZoneOf(zones, (power.lo + power.hi) / 2);
      else if (step.power?.units === 'power_zone') zone = Math.round(step.power.start ?? step.power.value) || null;
      else if (step.power?.units === '%ftp') {
        const pct = Math.max(step.power.start ?? step.power.value, step.power.end ?? step.power.value);
        zone = DEFAULT_POWER_PCT.findIndex((top) => pct <= top) + 1 || DEFAULT_POWER_PCT.length;
      }
      const hrRange = hrTargetRange(zones, step.hr, step._hr);
      if (step.power) {
        // HR on a bike step is only shown: no speed to steer
        if (hrRange) hr = { ...hrRange, mode: 'info' };
      } else if (hrRange) {
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

      const inclineText = parseIncline(step.text);
      const kind = step.warmup ? 'Warm-up' : step.cooldown ? 'Cooldown' : 'Work';
      const target = powerLabel || hrLabel || describePace(step.pace) ||
        (speedStart != null ? `pace ${formatPace(speedStart)}/km` : step.hr ? 'HR target' : 'free');

      out.push({
        label: [kind, ...path, target].join(' · '),
        text: step.text || '',
        kind,
        duration: step.duration || null,              // s
        distance: step.duration ? null : step.distance || null, // m
        speedStart: speedStart != null ? round1(clampSpeed(speedStart)) : null,
        speedEnd: speedEnd != null ? round1(clampSpeed(speedEnd)) : null,
        incline: clampIncline(inclineText ?? defaultIncline),
        hasTarget: speedStart != null,
        ramp: !!step.ramp,
        warmup: !!step.warmup,
        test: !!step.test,
        hr,
        power,  // bike steps: { lo, hi } W
        // Watts without a % become % of FTP, so the chart can draw the shape
        intensity: stepIntensity(step) ?? (power && zones?.ftp ? [(power.lo / zones.ftp) * 100, (power.hi / zones.ftp) * 100] : null),
        zone,   // pace zone (HR zone for an HR target, power zone on a bike), to color the chart
      });
    });
  };

  walk(doc?.steps || [], []);
  return out;
}

/**
 * Whether a workout (flattened without hrTargets) is one HR can steer, for
 * workouts that carry no hrControl flag (Intervals.icu): it has an HR target,
 * or long aerobic/tempo steps (Z1–Z3) and only easy steps (Z1–Z2) between them.
 */
export function followsHr(steps) {
  if (steps.some((s) => s.hr?.mode === 'target')) return true;
  const main = steps.filter((s) => s.kind === 'Work' && s.hasTarget);
  const long = main.filter((s) => (s.duration || 0) >= HR_STEP_MIN_S);
  return long.length > 0 &&
    main.every((s) => s.zone != null && s.zone <= (long.includes(s) ? 3 : 2));
}

/** Target speed within a step for a given progress (0..1), with ramps. */
export function targetSpeedAt(step, progress) {
  if (!step.hasTarget) return null;
  if (!step.ramp) return step.speedStart;
  const p = Math.min(1, Math.max(0, progress));
  return round1(step.speedStart + (step.speedEnd - step.speedStart) * p);
}

export function formatPace(kmh) {
  if (!kmh || kmh <= 0) return '--:--';
  const secPerKm = 3600 / kmh;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return (h ? `${h}:` : '') + `${mm}:${String(s).padStart(2, '0')}`;
}
