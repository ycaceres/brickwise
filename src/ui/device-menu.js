/**
 * What the device menus offer, from the driver registry and the connected
 * device: no DOM, so it is tested in Node. ui/devices.js draws it.
 */
import { driversFor } from '../devices/registry.js';

export const KIND_NAMES = { treadmill: 'treadmill', trainer: 'smart trainer' };

/**
 * How "Connect" works for a kind: one real driver (it opens its own chooser),
 * several (one chooser for all, then the driver is detected), or none yet.
 * Simulators come along with ?debug=true.
 */
export function connectPlan(kind, { debug = false } = {}) {
  const real = driversFor(kind);
  const simulators = debug ? driversFor(kind, { debug: true }).filter((d) => d.debugOnly) : [];
  if (real.length === 1) return { mode: 'single', driver: real[0], simulators };
  if (real.length > 1) return { mode: 'chooser', drivers: real, simulators };
  return { mode: 'none', simulators };
}

/**
 * Menu entries, in order: { action, label, driver?, primary?, danger?, disabled? }.
 * device: the connected one (or null); last: { driver, name } of the last one.
 */
export function menuEntries(kind, { debug = false, device = null, last = null } = {}) {
  const plan = connectPlan(kind, { debug });
  const name = KIND_NAMES[kind] || kind;
  const connected = !!device?.connected;
  const out = [];
  if (plan.mode === 'none') {
    out.push({ action: 'none', label: `No ${name} support yet`, disabled: true });
  } else {
    out.push({ action: 'connect', label: `Connect ${name}${last?.name ? ` (last: ${last.name})` : ''}`, primary: true, disabled: connected });
  }
  for (const d of plan.simulators) out.push({ action: 'simulator', driver: d.id, label: `Simulator: ${d.name}`, disabled: connected });
  if (connected && device.simulate) {
    out.push(kind === 'trainer'
      ? { action: 'sim-pedal', label: 'Start/stop pedaling (sim)' }
      : { action: 'sim-belt', label: 'Console Start/Stop (sim)' });
  }
  if (connected) out.push({ action: 'disconnect', label: 'Disconnect', danger: true });
  return out;
}
