import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTreadmillData, parseFeatures, parseSpeedRange, parseInclineRange, parseControlResponse, parseMachineStatus,
  requestControl, setTargetSpeed, setTargetIncline, stopOrPause, startOrResume,
} from '../src/devices/treadmill/ftms/protocol.js';
import ftms from '../src/devices/treadmill/ftms/index.js';

const view = (...b) => new DataView(Uint8Array.from(b).buffer);
const le16 = (x) => [x & 0xff, (x >> 8) & 0xff];

test('ftms: treadmill data with speed, distance, incline, HR and elapsed time', () => {
  // flags: speed present (bit0 = 0) | distance (bit2) | incline+ramp (bit3) | HR (bit8) | elapsed (bit10)
  const flags = 0x0004 | 0x0008 | 0x0100 | 0x0400;
  const d = parseTreadmillData(view(
    ...le16(flags), ...le16(1050),          // 10.50 km/h
    0x10, 0x27, 0x00,                       // 10000 m
    ...le16(25), ...le16(14),               // 2.5 %, 1.4°
    142,                                    // bpm
    ...le16(1800),                          // 30 min
  ));
  assert.deepEqual(d, { speed: 10.5, distance: 10000, incline: 2.5, rampAngle: 1.4, hr: 142, time: 1800 });
});

test('ftms: "more data" flag means no instantaneous speed; negative incline; energy and power', () => {
  const flags = 0x0001 | 0x0008 | 0x0080 | 0x1000;
  const d = parseTreadmillData(view(...le16(flags), ...le16(-15 & 0xffff), ...le16(0), ...le16(120), ...le16(600), 10, ...le16(40), ...le16(210)));
  assert.equal(d.speed, undefined);
  assert.equal(d.incline, -1.5);
  assert.deepEqual([d.calories, d.caloriesPerHour, d.caloriesPerMinute, d.force, d.power], [120, 600, 10, 40, 210]);
});

test('ftms: features, ranges, commands, control responses and machine status', () => {
  const f = parseFeatures(view(...le16((1 << 3) | (1 << 10)), 0, 0, ...le16(0b11), 0, 0));
  assert.deepEqual([f.inclineReported, f.hrReported, f.speedTarget, f.inclineTarget], [true, true, true, true]);
  assert.deepEqual(parseSpeedRange(view(...le16(50), ...le16(2000), ...le16(10))), { min: 0.5, max: 20, step: 0.1 });
  assert.deepEqual(parseInclineRange(view(...le16(-30 & 0xffff), ...le16(150), ...le16(5))), { min: -3, max: 15, step: 0.5 });
  assert.deepEqual([...requestControl()], [0x00]);
  assert.deepEqual([...setTargetSpeed(10.5)], [0x02, 0x1a, 0x04]);
  assert.deepEqual([...setTargetIncline(-2)], [0x03, 0xec, 0xff]);
  assert.deepEqual([...stopOrPause(true)], [0x08, 2]);
  assert.deepEqual([...stopOrPause(false)], [0x08, 1]);
  assert.deepEqual([...startOrResume()], [0x07]);
  assert.deepEqual(parseControlResponse(view(0x80, 0x02, 1)), { opcode: 2, result: 1, ok: true, text: 'success' });
  assert.equal(parseControlResponse(view(0x80, 0x00, 5)).text, 'control not permitted');
  assert.equal(parseControlResponse(view(0x02, 0, 0)), null);
  assert.deepEqual(parseMachineStatus(view(0x02, 2)), { event: 'stopped', belt: 'paused' });
  assert.deepEqual(parseMachineStatus(view(0x04)), { event: 'started', belt: 'running' });
  assert.deepEqual(parseMachineStatus(view(0x05, ...le16(900))), { event: 'target-speed', targetSpeed: 9 });
  assert.deepEqual(parseMachineStatus(view(0xff)), { event: 'control-lost' });
});

/** A fake FTMS treadmill over a fake GATT: answers control point writes with success. */
function fakeTreadmill() {
  const chars = {};
  const ch = (uuid, value) => {
    const c = {
      uuid, handlers: new Set(), written: [],
      addEventListener(n, f) { this.handlers.add(f); }, removeEventListener(n, f) { this.handlers.delete(f); },
      async startNotifications() {}, async stopNotifications() {},
      async readValue() { return value; },
      notify(v) { for (const h of this.handlers) h({ target: { value: v } }); },
      async writeValueWithResponse(data) { this.written.push([...data]); setTimeout(() => this.notify(view(0x80, data[0], 1)), 1); },
    };
    chars[uuid] = c;
    return c;
  };
  ch(0x2acc, view(...le16(1 << 3), 0, 0, ...le16(0b11), 0, 0));
  ch(0x2ad4, view(...le16(80), ...le16(1600), ...le16(10)));
  ch(0x2ad5, view(...le16(0), ...le16(100), ...le16(5)));
  ch(0x2acd); ch(0x2ada); ch(0x2ad9);
  const device = {
    name: 'FTMS-T1', listeners: {},
    addEventListener(n, f) { this.listeners[n] = f; },
    gatt: { connected: false, async connect() { this.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async (u) => chars[u] }) }; }, disconnect() { this.connected = false; } },
  };
  return { device, chars };
}

test('ftms: the driver connects, reads ranges, reports data and sends targets', async () => {
  const { device, chars } = fakeTreadmill();
  const statuses = [];
  const data = [];
  const logs = [];
  const dev = ftms.create({ onStatus: (s) => statuses.push(s), onData: (s) => data.push(s), onLog: (k, t) => logs.push([k, t]) });
  dev.setTarget({ speed: 9 });                 // before connecting: nothing sent, no error
  await dev.connect({ device });
  assert.deepEqual(statuses, ['connecting', 'initializing', 'ready']);
  assert.deepEqual(chars[0x2ad9].written[0], [0x00]);   // request control
  assert.deepEqual(dev.limits, { ...dev.limits, speedMin: 0.8, speedMax: 16, inclineMin: 0, inclineMax: 10 });
  assert.equal(dev.capabilities.incline, true);

  chars[0x2acd].notify(view(...le16(0x0008 | 0x0100), ...le16(950), ...le16(20), ...le16(0), 131));
  assert.deepEqual([data.at(-1).speed, data.at(-1).incline, data.at(-1).hr, data.at(-1).hrSource, data.at(-1).belt], [9.5, 2, 131, 'console', 'running']);

  dev.setTarget({ speed: 25, incline: 3.3 });   // clamped to 16 km/h and 3.5 %
  dev.pause();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(chars[0x2ad9].written.slice(1), [[0x02, 0x40, 0x06], [0x03, 35, 0], [0x08, 2]]);

  chars[0x2ada].notify(view(0xff));
  assert.ok(logs.some(([k, t]) => k === 'warn' && /another app/.test(t)));
  dev.disconnect();
  assert.equal(statuses.at(-1), 'disconnected');
  assert.equal(dev.connected, false);
});
