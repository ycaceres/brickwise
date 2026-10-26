/**
 * Heart rate variability from the strap's RR intervals.
 *
 * DFA α1 (detrended fluctuation analysis, scales of 4 to 16 beats) over the
 * last 2 minutes. Around 0.75 is the aerobic threshold (VT1) and around 0.5
 * the anaerobic one (VT2). It is only reliable with few artifacts (missed or
 * double beats), so above 5 % no value is given.
 */

export const ALPHA_WINDOW_MS = 120_000;
export const ALPHA_MIN_BEATS = 90;
export const MAX_ARTIFACT_PCT = 5;
export const VT1 = 0.75;
export const VT2 = 0.5;

/**
 * Removes artifacts: RR outside 300–2000 ms or more than 20 % away from the
 * median of the neighboring beats (±5), so one bad beat does not drag the
 * following ones.
 * @param {number[]} rr  ms
 */
export function cleanRr(rr) {
  const clean = [];
  let artifacts = 0;
  rr.forEach((v, i) => {
    const near = rr.slice(Math.max(0, i - 5), i + 6).sort((a, b) => a - b);
    const ref = near[near.length >> 1];
    if (v < 300 || v > 2000 || Math.abs(v - ref) / ref > 0.2) artifacts++;
    else clean.push(v);
  });
  return { clean, artifacts };
}

/** Least-squares slope of y over x. */
function slope(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return num / den;
}

/** DFA α1 of an RR series (ms). */
export function dfaAlpha1(rr, nMin = 4, nMax = 16) {
  const mean = rr.reduce((a, b) => a + b, 0) / rr.length;
  const y = [];
  let acc = 0;
  for (const v of rr) y.push((acc += v - mean));
  const logN = [];
  const logF = [];
  for (let n = nMin; n <= nMax; n++) {
    const boxes = Math.floor(y.length / n);
    if (boxes < 2) break;
    const xs = Array.from({ length: n }, (_, i) => i);
    let sq = 0;
    for (let b = 0; b < boxes; b++) {
      const seg = y.slice(b * n, b * n + n);
      // Linear trend of the box
      const k = slope(xs, seg);
      const c = seg.reduce((a, v) => a + v, 0) / n - k * (n - 1) / 2;
      for (let i = 0; i < n; i++) sq += (seg[i] - (c + k * i)) ** 2;
    }
    logN.push(Math.log(n));
    logF.push(Math.log(Math.sqrt(sq / (boxes * n))));
  }
  return logN.length >= 3 ? slope(logN, logF) : null;
}

/**
 * α1 of the window ending at `now`.
 * @param {Array<{t: number, rr: number}>} beats  t in ms
 * @returns {{alpha1: number|null, artifactPct: number, beats: number, reason?: string}}
 */
export function alpha1Window(beats, now) {
  const rr = beats.filter((b) => b.t > now - ALPHA_WINDOW_MS && b.t <= now).map((b) => b.rr);
  if (rr.length < ALPHA_MIN_BEATS) return { alpha1: null, artifactPct: 0, beats: rr.length, reason: 'too few beats' };
  const { clean, artifacts } = cleanRr(rr);
  const artifactPct = (artifacts / rr.length) * 100;
  if (artifactPct > MAX_ARTIFACT_PCT) return { alpha1: null, artifactPct, beats: rr.length, reason: 'noisy signal' };
  const a = dfaAlpha1(clean);
  return { alpha1: a == null ? null : Math.round(a * 100) / 100, artifactPct, beats: rr.length };
}

/** 'aerobic' (> 0.75), 'transition' (0.5–0.75), 'anaerobic' (< 0.5) or null. */
export function alphaState(a) {
  if (a == null) return null;
  return a > VT1 ? 'aerobic' : a >= VT2 ? 'transition' : 'anaerobic';
}

export const ALPHA_LABELS = { aerobic: 'aerobic', transition: 'transition', anaerobic: 'above threshold' };

/**
 * Simulated RR for simulation mode: correlated noise at rest (high α1) that
 * becomes random as HR rises (low α1).
 */
export class RrSimulator {
  constructor() {
    this.e = 0;
    this.acc = 0;
  }

  /** Beats (ms) generated over `dt` seconds at `bpm`. */
  next(bpm, dt) {
    const out = [];
    if (!bpm) return out;
    const effort = Math.min(1, Math.max(0, (bpm - 75) / 80));
    const phi = 0.92 * (1 - effort);
    const sd = 40 * (1 - effort) + 6;
    this.acc += dt * 1000;
    const mean = 60000 / bpm;
    while (this.acc >= mean) {
      this.acc -= mean;
      const g = Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
      this.e = phi * this.e + Math.sqrt(1 - phi * phi) * g * sd;
      out.push(Math.round(mean + this.e));
    }
    return out;
  }
}
