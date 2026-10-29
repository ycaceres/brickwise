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
