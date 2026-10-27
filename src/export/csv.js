import { formatPace } from '../workouts/steps.js';

/** CSV of the session samples (the chart's table view). */
export function samplesToCsv(samples) {
  const head = 'time_s,speed_kmh,pace_min_km,target_kmh,incline_pct,hr_bpm,distance_m,alpha1,rr_ms';
  const rows = samples.map((s) => [
    Math.round(s.elapsed), s.speed.toFixed(2), formatPace(s.speed), s.target ?? '',
    s.incline.toFixed(1), s.hr ?? '', s.distance.toFixed(1),
    s.alpha1 ?? '', (s.rr || []).join(';'), // that second's RRs, separated by ;
  ].join(','));
  return [head, ...rows].join('\n');
}
