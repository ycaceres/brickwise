import { formatPace } from '../workouts/steps.js';

/** A text field: quoted when it holds a comma or a quote. */
const text = (v) => (v == null ? '' : /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/**
 * CSV of the session samples (the chart's table view). Ride samples have no
 * incline (empty). The last columns tell what the HR control did (#10): the
 * step, the HR range it followed, the km/h HR added or removed, and the
 * reason on the second speed changed.
 */
export function samplesToCsv(samples) {
  const head = 'time_s,speed_kmh,pace_min_km,target_kmh,incline_pct,hr_bpm,distance_m,alpha1,rr_ms,step,hr_lo,hr_hi,hr_adjust_kmh,reason';
  const rows = samples.map((s) => [
    Math.round(s.elapsed), (s.speed ?? 0).toFixed(2), formatPace(s.speed), s.target ?? '',
    s.incline != null ? s.incline.toFixed(1) : '', s.hr ?? '', (s.distance ?? 0).toFixed(1),
    s.alpha1 ?? '', (s.rr || []).join(';'), // that second's RRs, separated by ;
    s.step ?? '', s.hrLo ?? '', s.hrHi ?? '', s.hrAdjust != null ? s.hrAdjust.toFixed(1) : '', text(s.reason),
  ].join(','));
  return [head, ...rows].join('\n');
}
