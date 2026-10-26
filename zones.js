/**
 * Athlete profile and HR / pace zones.
 *
 * The profile stores three numbers (threshold pace, LTHR, max HR) and the
 * percentages of each zone. Zones in bpm and km/h are always computed from
 * them, so editing the threshold or LTHR by hand moves every zone with it.
 *
 * Intervals.icu stores HR zones as each zone's top in bpm and pace zones as
 * the top in % of threshold speed (more % = faster; the last one is usually
 * 999). On load they are converted to % of LTHR.
 */

const MS_TO_KMH = 3.6;

/** Default percentages: Intervals.icu's running defaults (Friel). */
export const DEFAULT_PACE_PCT = [77.5, 87.7, 94.3, 100, 103.4, 111.5, 999];
export const DEFAULT_HR_PCT = [80, 89, 94, 100, 102, 106, 999];
const DEFAULT_PACE_NAMES = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5a', 'Z5b', 'Z5c'];

/**
 * @typedef {{thresholdKmh: number|null, lthr: number|null, maxHr: number|null,
 *            pacePct: number[], hrPct: number[], paceNames?: string[], hrNames?: string[],
 *            source: 'intervals'|'manual'}} Profile
 */

/** Profile from Intervals.icu running sport-settings. */
export function profileFromIntervals(s) {
  const lthr = s.lthr || null;
  const maxHr = s.max_hr || null;
  const hrZones = s.hr_zones || [];
  return {
    thresholdKmh: s.threshold_pace ? Math.round(s.threshold_pace * MS_TO_KMH * 100) / 100 : null,
    lthr,
    maxHr,
    pacePct: s.pace_zones?.length ? s.pace_zones : DEFAULT_PACE_PCT,
    // The last zone reaches max HR: marked with 999
    hrPct: lthr && hrZones.length
      ? hrZones.map((bpm, i) => (i === hrZones.length - 1 ? 999 : Math.round((bpm / lthr) * 1000) / 10))
      : DEFAULT_HR_PCT,
    paceNames: s.pace_zone_names || DEFAULT_PACE_NAMES,
    hrNames: s.hr_zone_names || null,
    source: 'intervals',
  };
}

/**
 * Zones in bpm and km/h from the profile.
 * @returns {{hr: Array<{z,name,lo,hi}>, pace: Array<{z,name,lo,hi}>, lthr, maxHr, thresholdKmh} | null}
 */
export function zonesFromProfile(p) {
  if (!p) return null;
  const lthr = p.lthr || (p.maxHr ? Math.round(p.maxHr * 0.91) : null);
  const maxHr = p.maxHr || (lthr ? Math.round(lthr * 1.1) : null);
  const hrTops = lthr
    ? p.hrPct.map((pct) => (pct >= 500 ? maxHr : Math.min(maxHr, Math.round((pct / 100) * lthr))))
    : [];
  const hr = hrTops.map((hi, i) => ({
    z: i + 1,
    name: p.hrNames?.[i] || `Z${i + 1}`,
    lo: i ? hrTops[i - 1] + 1 : 0,
    hi,
  }));
  const t = p.thresholdKmh;
  const pace = t
    ? p.pacePct.map((pct, i, arr) => ({
        z: i + 1,
        name: p.paceNames?.[i] || `Z${i + 1}`,
        lo: i ? (arr[i - 1] / 100) * t : 0,
        hi: pct >= 500 ? Infinity : (pct / 100) * t,
      }))
    : [];
  return { hr, pace, lthr, maxHr, thresholdKmh: t };
}

/** Compatibility: zones straight from Intervals sport-settings. */
export function normalizeZones(s) {
  return s ? zonesFromProfile(profileFromIntervals(s)) : null;
}

/** Pace zone (1..n) a speed belongs to. */
export function paceZoneOf(zones, kmh) {
  if (!zones?.pace.length || kmh == null) return null;
  const z = zones.pace.find((p) => kmh <= p.hi + 1e-6);
  return z ? z.z : zones.pace.length;
}

/** HR range [lo, hi] of an Intervals step's `hr` target. */
export function hrTargetRange(zones, hr, resolved) {
  if (hr && zones?.hr.length) {
    // With our own zones it is recomputed, so the profile wins over what Intervals resolved
    const lo = hr.start ?? hr.value;
    const hi = hr.end ?? hr.value;
    if (hr.units === 'hr_zone') {
      const zl = zones.hr[Math.round(lo) - 1];
      const zh = zones.hr[Math.round(hi) - 1];
      if (zl && zh) return { lo: zl.lo, hi: zh.hi };
    }
    const ref = hr.units === '%lthr' ? zones.lthr : hr.units === '%hr' ? zones.maxHr : null;
    if (ref) return widen((lo / 100) * ref, (hi / 100) * ref);
  }
  if (resolved && (resolved.start != null || resolved.value != null)) {
    const a = resolved.start ?? resolved.value;
    const b = resolved.end ?? resolved.value;
    return widen(Math.min(a, b), Math.max(a, b));
  }
  return null;
}

/** A single-value target becomes a ±3 bpm range. */
function widen(lo, hi) {
  lo = Math.round(lo);
  hi = Math.round(hi);
  return hi - lo < 4 ? { lo: lo - 3, hi: hi + 3 } : { lo, hi };
}

/** HR zone (1..n) a heart rate belongs to. */
export function hrZoneOf(zones, bpm) {
  if (!zones?.hr.length || !bpm) return null;
  const z = zones.hr.find((h) => bpm <= h.hi);
  return z ? z.z : zones.hr.length;
}

/**
 * Recomputes `_pace` (m/s) of steps with a relative pace (% of threshold or a
 * zone) from the profile. Absolute paces are kept. Used for library workouts
 * (which come unresolved) and so Intervals workouts use the profile's
 * threshold if it was edited by hand.
 */
export function resolveDoc(doc, zones) {
  if (!doc || !zones?.thresholdKmh) return doc;
  const t = zones.thresholdKmh / MS_TO_KMH; // m/s
  const walk = (steps) => steps.map((step) => {
    if (step.steps) return { ...step, steps: walk(step.steps) };
    const pace = step.pace;
    if (!pace) return step;
    const lo = pace.start ?? pace.value;
    const hi = pace.end ?? pace.value;
    if (pace.units === '%pace') {
      return { ...step, _pace: pace.start != null ? { start: (lo / 100) * t, end: (hi / 100) * t } : { value: (lo / 100) * t } };
    }
    if (pace.units === 'pace_zone') {
      const zl = zones.pace[Math.round(lo) - 1];
      const zh = zones.pace[Math.round(hi) - 1];
      if (!zl || !zh) return step;
      const top = Number.isFinite(zh.hi) ? zh.hi : zh.lo * 1.05;
      return { ...step, _pace: { start: Math.max(zl.lo, zl.hi * 0.85) / MS_TO_KMH, end: top / MS_TO_KMH } };
    }
    return step;
  });
  return { ...doc, steps: walk(doc.steps || []) };
}
