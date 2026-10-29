/**
 * Cycling step targets: watts from the cycling zones (or what Intervals.icu
 * resolved), the power zone, HR shown as information, label and intensity.
 */
import { hrTargetRange, DEFAULT_POWER_PCT } from '../physiology/zones.js';
import { paceIntensity } from './run.js';
import { t } from '../i18n/index.js';

/** Middle of a default power zone, in % of FTP. */
function powerZonePct(z) {
  const i = Math.min(DEFAULT_POWER_PCT.length, Math.max(1, Math.round(z))) - 1;
  const lo = i ? DEFAULT_POWER_PCT[i - 1] : 40;
  const hi = DEFAULT_POWER_PCT[i] >= 500 ? lo + 30 : DEFAULT_POWER_PCT[i];
  return (lo + hi) / 2;
}

/** Relative intensity of a power target in % of FTP, [start, end]; null for watts. */
function powerIntensity(step) {
  const p = step.power;
  if (!p || (p.start ?? p.value) == null) return null;
  const a = p.start ?? p.value;
  const b = p.end ?? p.value;
  if (p.units === '%ftp') return [a, b];
  if (p.units === 'power_zone') return [powerZonePct(a), powerZonePct(b)];
  return null;
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
  if (power.units === 'power_zone') return t('step.zonePower', { zone: power.start != null ? `${power.start}–${power.end}` : power.value }) + w;
  if (power.units === '%ftp') return t('step.pctFtp', { pct: power.start != null ? `${power.start}–${power.end}` : power.value }) + w;
  return watts ? `${watts.lo === watts.hi ? watts.lo : `${watts.lo}–${watts.hi}`} W` : '';
}

/** Watts, power zone, HR (information only: nothing to steer yet), label and intensity of a bike step. */
export function rideTargets(step, { zones = null } = {}) {
  const power = powerRange(step, zones);
  let zone = null;
  if (power) zone = powerZoneOf(zones, (power.lo + power.hi) / 2);
  else if (step.power?.units === 'power_zone') zone = Math.round(step.power.start ?? step.power.value) || null;
  else if (step.power?.units === '%ftp') {
    const pct = Math.max(step.power.start ?? step.power.value, step.power.end ?? step.power.value);
    zone = DEFAULT_POWER_PCT.findIndex((top) => pct <= top) + 1 || DEFAULT_POWER_PCT.length;
  }
  const hrRange = hrTargetRange(zones, step.hr, step._hr);
  const hr = hrRange ? { ...hrRange, mode: 'info' } : null;
  const label = describePower(step.power, power) || (step.hr ? t('step.hrTarget') : t('common.free'));
  // Watts without a % become % of FTP, so the chart can draw the shape
  const intensity = powerIntensity(step) ?? paceIntensity(step) ??
    (power && zones?.ftp ? [(power.lo / zones.ftp) * 100, (power.hi / zones.ftp) * 100] : null);
  return { power, zone, hr, label, intensity };
}
