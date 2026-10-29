/**
 * Text for the UI, without the DOM: what the components show, kept here so
 * the tests can check it.
 */
import { formatPace, formatDuration } from '../workouts/steps.js';
import { t } from '../i18n/index.js';

/** "Ana María López" → "AM" */
export function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/** "i12345 · Madrid, Spain", skipping what is missing. */
export function athleteMeta(athlete) {
  return [athlete?.id, [athlete?.city, athlete?.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
}

/**
 * Account stats: weight, sleep, resting HR and HRV, from the latest wellness
 * (Intervals.icu) or the athlete. Each one is { label, value, unit, date }; a
 * missing value is null.
 */
export function wellnessStats(wellness, athlete) {
  const weight = wellness?.weight?.value ?? athlete?.weight;
  const sleepMin = wellness?.sleepSecs?.value ? Math.round(wellness.sleepSecs.value / 60) : null;
  return [
    { label: t('stats.weight'), value: weight ? weight.toFixed(1) : null, unit: 'kg', date: wellness?.weight?.date },
    { label: t('stats.sleep'), value: sleepMin ? `${Math.floor(sleepMin / 60)}:${String(sleepMin % 60).padStart(2, '0')}` : null,
      unit: wellness?.sleepScore?.value != null ? `h · ${t('stats.score', { value: wellness.sleepScore.value })}` : 'h', date: wellness?.sleepSecs?.date },
    { label: t('stats.restingHr'), value: wellness?.restingHr?.value ?? athlete?.restingHr ?? null, unit: 'bpm', date: wellness?.restingHr?.date },
    { label: t('stats.hrv'), value: wellness?.hrv?.value != null ? Math.round(wellness.hrv.value) : null, unit: 'ms', date: wellness?.hrv?.date },
  ];
}

/** "LTHR 168 bpm @ 6:10 min/km · max HR 185 bpm", skipping what is missing. */
export function zoneSummary(lthr, at, maxHr) {
  const threshold = lthr ? `LTHR ${lthr} bpm${at ? ` @ ${at}` : ''}` : at ? t('zones.threshold', { value: at }) : null;
  return [threshold, maxHr ? t('zones.maxHr', { value: maxHr }) : null].filter(Boolean).join(' · ');
}

const hrRange = (h) => (h ? (h.lo ? `${h.lo}–${h.hi}` : `≤ ${h.hi}`) : '—');
const paceRange = (p) => (p
  ? (!p.lo ? t('zones.slowerThan', { pace: formatPace(p.hi) }) : Number.isFinite(p.hi) ? `${formatPace(p.hi)}–${formatPace(p.lo)}` : t('zones.fasterThan', { pace: formatPace(p.lo) }))
  : '—');
const powerRange = (p) => (p ? (!p.lo ? `≤ ${p.hi}` : Number.isFinite(p.hi) ? `${p.lo}–${p.hi}` : `≥ ${p.lo}`) : '—');

/**
 * A zone table for running (HR and pace) or cycling (HR and power):
 * { head, rows: [{ zone, name, cells }], summary }. Without zones, no rows.
 */
export function zoneTable(sport, z) {
  const ride = sport === 'ride';
  const other = ride ? z?.power : z?.pace;
  const n = Math.max(z?.hr?.length || 0, other?.length || 0);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const h = z.hr?.[i];
    const o = other?.[i];
    rows.push({ zone: i + 1, name: (ride && (o?.name || h?.name)) || '', cells: [hrRange(h), ride ? powerRange(o) : paceRange(o)] });
  }
  const at = ride ? (z?.ftp ? `${z.ftp} W` : null) : z?.thresholdKmh ? `${formatPace(z.thresholdKmh)} min/km` : null;
  return {
    head: [t('zones.zone'), t('zones.hrBpm'), ride ? t('zones.powerW') : t('zones.paceMinKm')],
    rows,
    summary: zoneSummary(z?.lthr, at, z?.maxHr),
  };
}

const km = (m) => (m != null ? `${(m / 1000).toFixed(2)} km` : null);

/**
 * Debug rows [label, text] for a device's normalized state (types.js
 * TreadmillState / TrainerState); missing values are null.
 */
export function stateRows(kind, s = {}) {
  if (kind === 'trainer') {
    return [
      ['Mode', s.mode ?? null],
      ['Power', s.power != null ? `${Math.round(s.power)} W` : null],
      ['Cadence', s.cadence != null ? `${Math.round(s.cadence)} rpm` : null],
      ['Speed', s.speed != null ? `${s.speed.toFixed(1)} km/h` : null],
      ['Distance', km(s.distance)],
      ['Time', s.elapsed != null ? formatDuration(s.elapsed) : null],
      ['Control', s.controlled ? 'this app' : s.mode ? 'none' : null],
    ];
  }
  return [
    ['Belt', s.belt ?? null],
    ['Actual speed', s.speed != null ? `${s.speed.toFixed(1)} km/h${s.speedSource === 'requested' ? ' (no actual reading)' : ''}` : null],
    ['Requested speed', s.targetSpeed != null ? `${s.targetSpeed.toFixed(1)} km/h` : null],
    ['Incline', s.incline != null ? `${s.incline.toFixed(1)} %` : null],
    ['Distance', km(s.distance)],
    ['Time', s.time != null ? formatDuration(s.time) : null],
    ['Calories', s.calories != null ? `${Math.round(s.calories)} kcal` : null],
  ];
}
