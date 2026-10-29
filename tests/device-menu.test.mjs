import test from 'node:test';
import assert from 'node:assert/strict';
import { connectPlan, menuEntries } from '../src/ui/device-menu.js';

const labels = (entries) => entries.map((e) => e.label);

test('device menu: treadmill, with and without debug', () => {
  assert.equal(connectPlan('treadmill').mode, 'single');
  assert.equal(connectPlan('treadmill').driver.id, 'nordictrack-exp5i');
  assert.deepEqual(labels(menuEntries('treadmill')), ['Connect treadmill']);
  assert.deepEqual(labels(menuEntries('treadmill', { debug: true })), ['Connect treadmill', 'Simulator: Simulated treadmill']);
  assert.deepEqual(labels(menuEntries('treadmill', { last: { driver: 'nordictrack-exp5i', name: 'I_TL1234' } })), ['Connect treadmill (last: I_TL1234)']);
});

test('device menu: no real smart trainer driver yet', () => {
  assert.equal(connectPlan('trainer').mode, 'none');
  const e = menuEntries('trainer');
  assert.deepEqual(labels(e), ['No smart trainer support yet']);
  assert.equal(e[0].disabled, true);
  assert.deepEqual(labels(menuEntries('trainer', { debug: true })), ['No smart trainer support yet', 'Simulator: Simulated smart trainer']);
});

test('device menu: a connected simulator offers its controls and Disconnect', () => {
  const tm = menuEntries('treadmill', { debug: true, device: { connected: true, simulate() {} } });
  assert.deepEqual(tm.map((x) => x.action), ['connect', 'simulator', 'sim-belt', 'disconnect']);
  assert.equal(tm[0].disabled, true);
  const tr = menuEntries('trainer', { debug: true, device: { connected: true, simulate() {} } });
  assert.deepEqual(tr.map((x) => x.action), ['none', 'simulator', 'sim-pedal', 'disconnect']);
  // A real device without simulate(): just Disconnect
  assert.deepEqual(menuEntries('treadmill', { device: { connected: true } }).map((x) => x.action), ['connect', 'disconnect']);
});
