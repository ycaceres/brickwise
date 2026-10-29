/**
 * What every treadmill driver shares: the events, the descriptor's
 * capabilities and limits, and setTarget(), which clamps to those limits and
 * rounds to their steps before the driver's own setSpeed / setIncline.
 * Drivers publish normalized readings (see types.js TreadmillState).
 */

const noop = () => {};

const clamp = (v, lo, hi) => Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, v));
const roundTo = (v, step) => (step ? Math.round(v / step) * step : v);
const tidy = (v) => Math.round(v * 100) / 100;

export class Treadmill {
  constructor({ onStatus = noop, onData = noop, onInfo = noop, onLog = noop } = {}, descriptor = {}) {
    Object.assign(this, { onStatus, onData, onInfo, onLog });
    this.descriptor = descriptor;
    this.capabilities = { ...descriptor.capabilities };
    this.limits = { ...descriptor.limits };
    this.requested = { speed: null, incline: null };
  }

  clampSpeed(kmh) {
    const l = this.limits;
    return tidy(roundTo(clamp(kmh, l.speedMin, l.speedMax), l.speedStep));
  }

  clampIncline(pct) {
    const l = this.limits;
    return tidy(roundTo(clamp(pct, l.inclineMin, l.inclineMax), l.inclineStep));
  }

  /** Asks for a speed (km/h) and / or incline (%), within the treadmill's limits. */
  setTarget({ speed, incline } = {}) {
    if (speed != null) {
      this.requested.speed = this.clampSpeed(speed);
      this.setSpeed(this.requested.speed);
    }
    if (incline != null && this.capabilities.incline !== false) {
      this.requested.incline = this.clampIncline(incline);
      this.setIncline(this.requested.incline);
    }
  }

  /** Driver-specific rows for the Debug page: [label, value]. */
  diagnostics() {
    return [];
  }
}
