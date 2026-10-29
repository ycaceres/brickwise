import test from 'node:test';
import assert from 'node:assert/strict';
import { state, on, setProfile, setSelection, setDevice, zonesForEvent, zonesFor } from '../src/state.js';

const ride = { hr: [{ z: 1, lo: 0, hi: 120 }], power: [{ z: 1, lo: 0, hi: 104 }], ftp: 190, lthr: 162, maxHr: 185 };
const run = { hr: [{ z: 1, lo: 0, hi: 134 }], pace: [{ z: 1, lo: 0, hi: 7.5 }], lthr: 168, ride };

test('state: zonesForEvent picks running or cycling zones', () => {
  assert.equal(zonesForEvent(run, { sport: 'run' }), run);
  assert.equal(zonesForEvent(run, null), run);
  assert.deepEqual(zonesForEvent(run, { sport: 'ride' }), { hr: ride.hr, pace: [], power: ride.power, ftp: 190, lthr: 162, maxHr: 185 });
  assert.equal(zonesForEvent({ ...run, ride: null }, { sport: 'ride' }), null);
  assert.equal(zonesForEvent(null, { sport: 'run' }), null);
});

test('state: setProfile computes the zones and notifies', () => {
  const seen = [];
  on('profile', (p) => seen.push(p));
  setProfile({ thresholdKmh: 9.73, lthr: 168, maxHr: 185, pacePct: [78, 88, 94, 100, 103, 111, 999], hrPct: [80, 89, 94, 100, 102, 106, 999] });
  assert.equal(state.zones.lthr, 168);
  assert.ok(state.zones.hr.length && state.zones.pace.length);
  assert.equal(zonesFor({ sport: 'run' }), state.zones);
  assert.equal(seen.length, 1);
  setProfile(null);
  assert.equal(state.zones, null);
});

test('state: selection and devices notify with their value', () => {
  const seen = [];
  on('selection', (s) => seen.push(['selection', s?.key ?? null]));
  on('device', (d) => seen.push(['device', d.kind, d.device?.id ?? null]));
  setSelection({ key: 'l:z2-45-1', event: {}, steps: [] });
  setDevice('controllable', { id: 'sim' });
  setSelection(null);
  assert.deepEqual(seen, [['selection', 'l:z2-45-1'], ['device', 'controllable', 'sim'], ['selection', null]]);
  assert.equal(state.devices.controllable.id, 'sim');
  assert.equal(state.selection, null);
});
