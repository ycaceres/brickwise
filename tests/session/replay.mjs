/**
 * Feeds a session exported as CSV by Brickwise (export/csv.js) back into the
 * engine, one row per second, to reproduce what happened in a real session.
 */

/** time_s, speed_kmh, …, hr_bpm, …, alpha1 → [{ elapsed, speed, hr, alpha1 }] */
export function parseSessionCsv(text) {
  const [head, ...lines] = text.trim().split('\n');
  const cols = head.split(',');
  const at = (name) => cols.indexOf(name);
  const [t, speed, hr, alpha] = ['time_s', 'speed_kmh', 'hr_bpm', 'alpha1'].map(at);
  return lines.map((line) => {
    const c = line.split(',');
    const num = (i) => (i >= 0 && c[i] !== '' ? Number(c[i]) : null);
    return { elapsed: num(t), speed: num(speed), hr: num(hr), alpha1: num(alpha) };
  });
}

/** Plays the rows through a harness session (tests/session/harness.mjs). */
export function replay(h, rows) {
  for (const r of rows) h.run(1, { speed: r.speed ?? 0, hr: r.hr, ...(r.alpha1 != null && { alpha1: r.alpha1 }) });
}
