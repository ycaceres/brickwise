/**
 * Checks every device driver must pass. Descriptor checks run for all of
 * them; lifecycle checks for drivers that work without Bluetooth (simulators).
 * Used by tests/devices.test.mjs; new drivers get them for free.
 */
import assert from 'node:assert/strict';

export const KINDS = ['treadmill', 'trainer', 'hr', 'power', 'cadence'];

export function checkDescriptor(d) {
  assert.match(d.id, /^[a-z0-9-]+$/, 'id: lowercase words with dashes');
  assert.ok(KINDS.includes(d.kind), `${d.id}: kind ${d.kind}`);
  assert.ok(d.name, `${d.id}: name`);
  assert.equal(typeof d.create, 'function', `${d.id}: create`);
  assert.equal(typeof d.capabilities, 'object', `${d.id}: capabilities`);
  if (!d.debugOnly) {
    const m = d.match || {};
    assert.ok(m.namePrefix?.length || m.services?.length, `${d.id}: a real driver needs match.namePrefix or match.services`);
  }
  for (const key of ['speed', 'incline', 'power', 'resistance', 'grade']) {
    const lo = d.limits?.[`${key}Min`];
    const hi = d.limits?.[`${key}Max`];
    if (lo != null || hi != null) assert.ok(lo < hi, `${d.id}: ${key}Min < ${key}Max`);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Connect → ready, readings flow, pauseNow is safe, disconnect stops everything. */
export async function checkLifecycle(d) {
  const statuses = [];
  const dev = d.create({ onStatus: (s) => statuses.push(s) });
  assert.doesNotThrow(() => dev.pauseNow?.(), 'pauseNow before connecting');
  assert.equal(dev.connected, false);
  await dev.connect();
  assert.deepEqual(statuses, ['connecting', 'initializing', 'ready']);
  assert.equal(dev.connected, true);
  const t0 = dev.state.updatedAt;
  await wait(500);
  assert.ok(dev.state.updatedAt > t0, 'readings keep coming');
  assert.doesNotThrow(() => dev.pauseNow?.());
  dev.disconnect();
  assert.equal(statuses.at(-1), 'disconnected');
  assert.equal(dev.connected, false);
  await wait(300);
  const t1 = dev.state.updatedAt;
  await wait(500);
  assert.equal(dev.state.updatedAt, t1, 'no timer left running after disconnect');
}

/** Treadmills: the common interface, and targets clamped to the limits (no connection needed). */
export function checkTreadmill(d) {
  const dev = d.create({});
  assert.deepEqual(dev.limits, d.limits, `${d.id}: limits from the descriptor`);
  assert.equal(dev.capabilities.speed, true, `${d.id}: speed capability`);
  assert.equal(typeof dev.setTarget, 'function');
  assert.ok(Array.isArray(dev.diagnostics()), `${d.id}: diagnostics() rows`);
  dev.setTarget({ speed: d.limits.speedMax + 5, incline: d.limits.inclineMax + 5 });
  assert.equal(dev.requested.speed, d.limits.speedMax);
  assert.equal(dev.requested.incline, d.limits.inclineMax);
  assert.doesNotThrow(() => dev.pause());
}

/** Smart trainers: the common interface, modes and targets clamped to the limits (no connection needed). */
export function checkTrainer(d) {
  const dev = d.create({});
  assert.deepEqual(dev.limits, d.limits, `${d.id}: limits from the descriptor`);
  assert.equal(dev.capabilities.erg, true, `${d.id}: ERG capability`);
  for (const m of ['setMode', 'setTarget', 'setResistance', 'setSimulation', 'stop', 'diagnostics']) assert.equal(typeof dev[m], 'function', `${d.id}: ${m}`);
  dev.rampSeconds = 0.01;
  dev.rampMs = 5;
  dev.setTarget({ power: d.limits.powerMax + 500 });
  assert.equal(dev.requested.power, d.limits.powerMax);
  assert.equal(dev.mode, 'erg');
  dev.setResistance(250);
  assert.equal(dev.requested.resistance, d.limits.resistanceMax ?? 100);
  assert.equal(dev.mode, 'resistance');
  dev.setSimulation({ grade: 99 });
  assert.equal(dev.requested.simulation.grade, d.limits.gradeMax);
  dev.stop();
  assert.equal(dev.mode, 'idle');
  assert.ok(Array.isArray(dev.diagnostics()));
}
