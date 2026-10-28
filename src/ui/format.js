/**
 * Text for the UI, without the DOM: what the components show, kept here so
 * the tests can check it.
 */

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
    { label: 'Weight', value: weight ? weight.toFixed(1) : null, unit: 'kg', date: wellness?.weight?.date },
    { label: 'Sleep', value: sleepMin ? `${Math.floor(sleepMin / 60)}:${String(sleepMin % 60).padStart(2, '0')}` : null,
      unit: wellness?.sleepScore?.value != null ? `h · score ${wellness.sleepScore.value}` : 'h', date: wellness?.sleepSecs?.date },
    { label: 'Resting HR', value: wellness?.restingHr?.value ?? athlete?.restingHr ?? null, unit: 'bpm', date: wellness?.restingHr?.date },
    { label: 'HRV', value: wellness?.hrv?.value != null ? Math.round(wellness.hrv.value) : null, unit: 'ms', date: wellness?.hrv?.date },
  ];
}
