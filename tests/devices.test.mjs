import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVERS, driversFor, getDriver, requestOptions, detect } from '../src/devices/registry.js';
import { connectGatt, subscribe } from '../src/devices/ble/gatt.js';
import { createWriteQueue } from '../src/devices/ble/write-queue.js';
import { checkDescriptor, checkLifecycle } from './devices/contract.mjs';

test('drivers: every descriptor follows the contract, ids are unique', () => {
  for (const d of DRIVERS) checkDescriptor(d);
  assert.equal(new Set(DRIVERS.map((d) => d.id)).size, DRIVERS.length);
});

for (const d of DRIVERS.filter((x) => x.debugOnly)) {
  test(`drivers: ${d.id} lifecycle`, () => checkLifecycle(d));
}

test('registry: simulators only with debug; lookups', () => {
  assert.deepEqual(driversFor('treadmill').map((d) => d.id), ['nordictrack-exp5i']);
  assert.deepEqual(driversFor('treadmill', { debug: true }).map((d) => d.id), ['nordictrack-exp5i', 'simulated-treadmill']);
  assert.equal(getDriver('hr-strap').kind, 'hr');
  assert.equal(getDriver('nope'), null);
});

test('registry: requestDevice options and detection', () => {
  const t = requestOptions('treadmill');
  assert.ok(t.filters.some((f) => f.namePrefix === 'I_'));
  assert.ok(t.optionalServices.length >= 1);
  assert.deepEqual(requestOptions('hr'), { filters: [{ services: ['heart_rate'] }], optionalServices: ['heart_rate'] });
  assert.equal(detect('treadmill', { name: 'I_TL123' }).id, 'nordictrack-exp5i');
  assert.equal(detect('treadmill', { name: 'Other' }).id, 'nordictrack-exp5i'); // the only real treadmill driver
  assert.equal(detect('trainer', { name: 'KICKR' }), null);
});

test('ble: write queue keeps order, retries, and a failure does not block the next write', async () => {
  const done = [];
  let fails = 1;
  const write = async (x) => {
    if (x === 'b' && fails-- > 0) throw new Error('busy');
    await new Promise((r) => setTimeout(r, x === 'a' ? 20 : 1));
    done.push(x);
  };
  const q = createWriteQueue(write, { retries: 2, retryDelayMs: 1 });
  await Promise.all([q('a'), q('b'), q('c')]);
  assert.deepEqual(done, ['a', 'b', 'c']);
  const always = createWriteQueue(async () => { throw new Error('gone'); }, { retries: 1, retryDelayMs: 1 });
  await assert.rejects(always('x'), /gone/);
  const q2 = createWriteQueue(async (x) => x, { retries: 0 });
  assert.equal(await q2('ok'), 'ok');
});

test('ble: connect with timeout, subscribe and unsubscribe', async () => {
  const listeners = {};
  const slow = { name: 'Slow', addEventListener: (n, f) => { listeners[n] = f; }, gatt: { connect: () => new Promise(() => {}) } };
  await assert.rejects(connectGatt(slow, { timeoutMs: 20, onDisconnect: () => {} }), /no answer from Slow/);
  assert.equal(typeof listeners.gattserverdisconnected, 'function');
  const fast = { addEventListener() {}, gatt: { connect: async () => 'server' } };
  assert.equal(await connectGatt(fast), 'server');

  const ch = {
    handlers: new Set(), notifying: false,
    addEventListener(n, f) { this.handlers.add(f); },
    removeEventListener(n, f) { this.handlers.delete(f); },
    async startNotifications() { this.notifying = true; },
    async stopNotifications() { this.notifying = false; },
  };
  const got = [];
  const stop = await subscribe(ch, (v) => got.push(v));
  for (const h of ch.handlers) h({ target: { value: 42 } });
  await stop();
  assert.deepEqual(got, [42]);
  assert.equal(ch.handlers.size, 0);
  assert.equal(ch.notifying, false);
});
