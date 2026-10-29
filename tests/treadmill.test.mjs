// Treadmill protocol, iFit message decoding and HR strap (no hardware)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpeedPacket, buildInclinePacket, parseNotification, INIT_SEQUENCE, POLL_CYCLE, toHex, WRITE_HEADER,
} from '../src/devices/treadmill/nordictrack-exp5i/protocol.js';
import {
  MessageAssembler, parseRequest, parseResponse, decodeReads, toStatus, MODE, buildWriteAndRead, buildRequest, chunkMessage,
} from '../src/devices/treadmill/nordictrack-exp5i/messages.js';
import { parseHeartRate } from '../src/devices/sensors/hr-strap/driver.js';

// Literal replica of qdomyos-zwift's forceSpeed/forceIncline for the EXP 5i
function qzForce(selector, value, base) {
  const w = [0xff, 0x0d, 0x02, 0x04, 0x02, 0x09, 0x04, 0x09, 0x02, 0x01,
             selector, 0xbc, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const raw = Math.round(value * 100) & 0xffff;
  w[12] = (raw >> 8) & 0xff;
  w[11] = raw & 0xff;
  w[14] = (w[11] + w[12] + base) & 0xff;
  return toHex(w);
}

test('speed: same as qdomyos-zwift (checksum +0x11)', () => {
  for (const kmh of [0, 0.8, 5, 8.7, 10, 12.3, 16]) {
    assert.equal(toHex(buildSpeedPacket(kmh)), qzForce(0x01, kmh, 0x11), `${kmh} km/h`);
  }
  assert.deepEqual(toHex(buildSpeedPacket(10)).split(' ').slice(11, 15), ['e8', '03', '00', 'fc']);
});

test('incline: same as qdomyos-zwift (checksum +0x12)', () => {
  for (const pct of [0, 0.5, 1, 2.5, 7, 10]) {
    assert.equal(toHex(buildInclinePacket(pct)), qzForce(0x02, pct, 0x12), `${pct}%`);
  }
});

test('EXP 5i limits', () => {
  assert.equal(toHex(buildSpeedPacket(25)), qzForce(0x01, 16, 0x11));
  assert.equal(toHex(buildInclinePacket(15)), qzForce(0x02, 10, 0x12));
  assert.equal(toHex(buildInclinePacket(-3)), qzForce(0x02, 0, 0x12));
});

test('checksums of single-packet init commands add up', () => {
  // ff n 02 04 02 | LL | EE LL CC [payload] | SS  → SS = EE + LL + CC + payload (LL = payload + 4)
  const single = INIT_SEQUENCE.filter((p) => p[0] === 0xff && p[2] === 0x02 && p[3] === 0x04);
  assert.equal(single.length, 6); // 0x81 0x80 0x88 0x82 0x84 0x95
  for (const pkt of single) {
    const len = pkt[5];
    const sum = Array.from(pkt.slice(6, 5 + len)).reduce((a, x) => a + x, 0) & 0xff;
    assert.equal(sum, pkt[5 + len], toHex(pkt));
  }
  // And the same format yields the checksum of the speed commands
  const spd = buildSpeedPacket(9.7);
  assert.equal(Array.from(spd.slice(6, 14)).reduce((a, x) => a + x, 0) & 0xff, spd[14]);
});

test('full sequences', () => {
  assert.equal(INIT_SEQUENCE.length, 25);
  assert.equal(POLL_CYCLE.length, 6);
  assert.ok(INIT_SEQUENCE.every((p) => p.length === 4 || p.length === 20));
  assert.equal(POLL_CYCLE.filter((s) => s.applyRequests).length, 1);
});

test('parseNotification: status packet', () => {
  // 8.50 km/h (0x0352), 2.00 % (0x00c8), 0 W
  const pkt = [0x00, 0x12, 0x01, 0x04, 0x02, 0x2e, 0, 0, 0, 0, 0x52, 0x03, 0xc8, 0x00, 0x00, 0x00, 0, 0, 0, 0];
  assert.deepEqual(parseNotification(pkt), { speed: 8.5, incline: 2, watts: 0 });
});

test('parseNotification: negative incline and filters', () => {
  const neg = [0x00, 0x12, 0x01, 0x04, 0x02, 0x2e, 0, 0, 0, 0, 0, 0, 0x9c, 0xff, 0, 0, 0, 0, 0, 0];
  assert.equal(parseNotification(neg).incline, -1);
  assert.equal(parseNotification(neg.with(5, 0x2f)), null);   // another message type
  assert.equal(parseNotification(neg.slice(0, 19)), null);    // wrong length
  const ff = neg.map((x, i) => (i >= 12 ? 0xff : x));
  assert.equal(parseNotification(ff), null);
  const bigWatts = neg.with(14, 0xb9).with(15, 0x0b);          // 3001
  assert.equal(parseNotification(bigWatts), null);
});

// ---------------------------------------------------------------------------
// Full decoding (nordictrack-exp5i/messages.js)
// ---------------------------------------------------------------------------

/** Same as ianchi/ifit's build_write_messages. */
function chunk(msg) {
  const n = Math.ceil(msg.length / 18);
  const out = [Uint8Array.from([0xfe, 0x02, msg.length, n + 1])];
  for (let i = 0; i < n; i++) {
    const part = msg.slice(i * 18, i * 18 + 18);
    const pkt = new Uint8Array(20);
    pkt[0] = i === n - 1 ? 0xff : i;
    pkt[1] = part.length;
    pkt.set(part, 2);
    out.push(pkt);
  }
  return out;
}

function assemble(packets) {
  const a = new MessageAssembler();
  let msg = null;
  for (const p of packets) msg = a.push(p) || msg;
  return msg;
}

/** Respuesta 01 04 02 LL EE LL CC 02 <valores> SS */
function response(command, values, equipment = 0x04) {
  const len = values.length + 5;
  const msg = Uint8Array.from([0x01, 0x04, 0x02, len, equipment, len, command, 0x02, ...values, 0]);
  msg[msg.length - 1] = msg.slice(4, -1).reduce((a, x) => a + x, 0) & 0xff;
  return msg;
}

const le = (v, n) => Array.from({ length: n }, (_, i) => (v >> (8 * i)) & 0xff);

test('polling cycle requests: which data each one asks for', () => {
  const reqA = parseRequest(assemble(POLL_CYCLE.slice(0, 3).map((s) => s.data)));
  const reqB = parseRequest(assemble(POLL_CYCLE.slice(3, 6).map((s) => s.data)));
  assert.equal(reqA.name, 'WRITE_AND_READ');
  assert.ok(reqA.checksumOk && reqB.checksumOk);
  assert.deepEqual(reqA.readIds, [7, 11, 22, 103, 116]);
  assert.deepEqual(reqB.readIds, [0, 1, 4, 9, 10, 12, 15, 16, 20, 21, 46, 52, 71, 75, 76, 96]);
  assert.deepEqual(reqB.writeValues, {});
});

test('speed and incline write requests', () => {
  const spd = parseRequest(assemble([WRITE_HEADER, buildSpeedPacket(9.7)]));
  assert.deepEqual(spd.writeValues, { Kph: 9.7 });
  assert.deepEqual(spd.readIds, []);
  assert.ok(spd.checksumOk);
  const inc = parseRequest(assemble([WRITE_HEADER, buildInclinePacket(2.5)]));
  assert.deepEqual(inc.writeValues, { Incline: 2.5 });
});

test('init requests: commands 0x81 0x80 0x88 0x82 0x84 0x95 0x90', () => {
  const a = new MessageAssembler();
  const names = [];
  for (const p of INIT_SEQUENCE) {
    const msg = a.push(p);
    if (msg) names.push(parseRequest(msg)?.name);
  }
  assert.deepEqual(names.slice(0, 7), [
    'EQUIPMENT_INFORMATION', 'SUPPORTED_CAPABILITIES', 'SUPPORTED_COMMANDS',
    'EQUIPMENT_REFERENCE', 'EQUIPMENT_FIRMWARE', 'EQUIPMENT_SERIAL', 'ENABLE',
  ]);
});

// Values of the response to the cycle's second message (41 bytes, 50 in total)
const statusValues = [
  ...le(850, 2),              // 0  Kph 8.50
  ...le(200, 2),              // 1  Incline 2.00
  ...le(1234, 4),             // 4  CurrentDistance 1234 m
  5,                          // 9  Volume
  142, 138, 10, 1,            // 10 Pulse 142, avg 138, hand grips
  MODE.ACTIVE,                // 12 Mode
  ...le(0, 2),                // 15
  ...le(845, 2),              // 16 CurrentKph 8.45
  ...le(600, 4),              // 20 CurrentTime 600 s
  ...le(Math.round(55 * 100000000 / 1024), 4), // 21 CurrentCalories 55
  ...le(0, 2), ...le(0, 2), ...le(0, 2),       // 46 52 71
  ...le(0, 4), ...le(0, 4),                    // 75 76
  0x07,                                        // 96 (inferred size)
];

test('status response: assembly, length and qdomyos-zwift filter', () => {
  const msg = response(0x02, statusValues);
  assert.equal(msg.length, 50);
  assert.equal(msg[3], 0x2e);
  const packets = chunk(msg);
  assert.deepEqual(Array.from(packets[0]), [0xfe, 0x02, 50, 4]);
  // The first packet is exactly what qdomyos-zwift expects: 00 12 01 04 02 2e
  assert.deepEqual(Array.from(packets[1].slice(0, 6)), [0x00, 0x12, 0x01, 0x04, 0x02, 0x2e]);
  // …and reading it directly matches Kph / Incline
  assert.deepEqual(parseNotification(packets[1]), { speed: 8.5, incline: 2, watts: 1234 });
  assert.deepEqual(assemble(packets), msg);
});

test('status response: full decoding', () => {
  const reqB = parseRequest(assemble(POLL_CYCLE.slice(3, 6).map((s) => s.data)));
  const res = parseResponse(response(0x02, statusValues), reqB);
  assert.ok(res.ok && res.checksumOk && res.lengthOk);
  assert.ok(res.complete);
  assert.equal(res.values.Kph, 8.5);
  assert.equal(res.values.CurrentKph, 8.45);
  assert.equal(res.values.CurrentDistance, 1234);
  assert.deepEqual(res.values.Pulse, { bpm: 142, avg: 138, count: 10, source: 1 });
  assert.equal(res.values.Mode, MODE.ACTIVE);
  assert.equal(res.values.CurrentTime, 600);
  assert.ok(Math.abs(res.values.CurrentCalories - 55) < 0.01);
  assert.equal(res.values.Unknown96, '07');
  assert.deepEqual(toStatus(res.values), {
    speed: 8.45, speedSource: 'real', targetSpeed: 8.5, incline: 2, mode: 2,
    pulse: { bpm: 142, avg: 138, count: 10, source: 1 },
    distance: 1234, time: 600, calories: res.values.CurrentCalories,
  });
});

test('response with non-OK status and wrong checksum', () => {
  const bad = response(0x02, []);
  bad[7] = 0x01;
  bad[bad.length - 1] = bad.slice(4, -1).reduce((a, x) => a + x, 0) & 0xff;
  assert.equal(parseResponse(bad, null).ok, false);
  const wrongSum = response(0x02, [1, 2]);
  wrongSum[wrongSum.length - 1] ^= 0xff;
  assert.equal(parseResponse(wrongSum, null).checksumOk, false);
});

test('decodeReads stops at an unknown size that is not the last', () => {
  const msg = response(0x02, [...le(500, 2), 1, 2, 3, ...le(300, 2)]);
  const r = decodeReads(msg, [0, 116, 1]);
  assert.equal(r.values.Kph, 5);
  assert.equal(r.complete, false);
  assert.deepEqual(r.unknown, [116, 1]);
});

test('init responses: supported, firmware, serial, model', () => {
  // 0x81: bitmap from byte 16 (length 2: ids 0, 1, 12)
  const info = response(0x81, [0, 0, 0, 0, 0, 0, 0, 0, 2, 0x03, 0x10]);
  assert.deepEqual(parseResponse(info).supported, [0, 1, 12]);
  const fw = response(0x84, [0, 0, 0, ...Array.from('84.12', (c) => c.charCodeAt(0)), 0]);
  assert.equal(parseResponse(fw).firmware, '84.12');
  const sn = response(0x95, [5, ...Array.from('AB123', (c) => c.charCodeAt(0))]);
  assert.equal(parseResponse(sn).serial, 'AB123');
  const ref = response(0x82, [0, 0, 0, 0, 0, 0, 0, ...le(410224, 4)]);
  assert.equal(parseResponse(ref).reference, 410224);
});

test('MessageAssembler rejects out-of-range packets', () => {
  const a = new MessageAssembler();
  a.push([0xfe, 0x02, 10, 2]);
  assert.throws(() => a.push([0x03, 2, 1, 2]));
});

test('toStatus: actual speed 0 while running uses the requested one', () => {
  assert.deepEqual(
    [toStatus({ Kph: 5, CurrentKph: 0, Mode: MODE.ACTIVE }).speed, toStatus({ Kph: 5, CurrentKph: 0, Mode: MODE.ACTIVE }).speedSource],
    [5, 'requested'],
  );
  assert.equal(toStatus({ Kph: 5, CurrentKph: 4.9, Mode: MODE.ACTIVE }).speed, 4.9);
  assert.equal(toStatus({ Kph: 5, CurrentKph: 0, Mode: MODE.PAUSE }).speed, 0);   // paused: stopped
  assert.equal(toStatus({ Kph: 0, CurrentKph: 0, Mode: MODE.ACTIVE }).speed, 0);
  assert.equal(toStatus({ Kph: 3 }).speed, 3);                                   // no mode and no field 16
});


test('buildWriteAndRead reproduces qdomyos-zwift speed and incline packets', () => {
  for (const kmh of [0.8, 5, 9.7, 16]) {
    assert.deepEqual(buildWriteAndRead({ 0: kmh }).map(toHex), [toHex(WRITE_HEADER), toHex(buildSpeedPacket(kmh))]);
  }
  for (const pct of [0, 1.5, 10]) {
    assert.deepEqual(buildWriteAndRead({ 1: pct }).map(toHex), [toHex(WRITE_HEADER), toHex(buildInclinePacket(pct))]);
  }
});

test('buildWriteAndRead reproduces the polling cycle messages', () => {
  const reqB = assemble(POLL_CYCLE.slice(3, 6).map((s) => s.data));
  const ids = parseRequest(reqB).readIds;
  assert.deepEqual(assemble(buildWriteAndRead({}, ids)), reqB);
});

test('writing the mode (pause) and reading limits', () => {
  const pause = assemble(buildWriteAndRead({ 12: MODE.PAUSE }));
  const req = parseRequest(pause);
  assert.deepEqual(req.writeValues, { Mode: 3 });
  assert.ok(req.checksumOk);
  assert.equal(toHex(pause), '02 04 02 09 04 09 02 02 00 10 03 00 24');
  const lim = parseRequest(assemble(buildWriteAndRead({}, [31, 27, 30, 28])));
  assert.deepEqual(lim.readIds, [27, 28, 30, 31]);
  const res = parseResponse(response(0x02, [...le(1000, 2), ...le(0, 2), ...le(1600, 2), ...le(80, 2)]), lim);
  assert.deepEqual(res.values, { MaxIncline: 10, MinIncline: 0, MaxKph: 16, MinKph: 0.8 });
  assert.throws(() => buildWriteAndRead({ 4: 1 }));
});

test('chunkMessage/buildRequest: 38 bytes = header + 3 packets', () => {
  const msg = buildRequest(0x04, 0x02, new Array(30).fill(1));
  const packets = chunkMessage(msg);
  assert.equal(packets.length, 4);
  assert.deepEqual(Array.from(packets[0]), [0xfe, 0x02, 38, 4]);
  assert.deepEqual([packets[1][0], packets[2][0], packets[3][0]], [0, 1, 0xff]);
  assert.deepEqual(assemble(packets), msg);
});

// ---------------------------------------------------------------------------
// HR strap
// ---------------------------------------------------------------------------
test('HR strap: heart rate, contact and RR intervals', () => {
  // flags 0x16: 8-bit HR, contact reported and present, RR present
  const bytes = new Uint8Array([0x16, 72, 0x00, 0x04, 0x66, 0x03]); // RR 1024/1024 s and 870/1024 s
  const m = parseHeartRate(new DataView(bytes.buffer));
  assert.equal(m.bpm, 72);
  assert.equal(m.contact, true);
  assert.deepEqual(m.rr, [1000, 850]);
  // 16-bit HR and energy expended before the RRs
  const b2 = new Uint8Array([0x19, 150, 0, 0x10, 0x00, 0x00, 0x02]);
  const m2 = parseHeartRate(new DataView(b2.buffer));
  assert.equal(m2.bpm, 150);
  assert.equal(m2.contact, null);
  assert.deepEqual(m2.rr, [500]);
});

// Treadmill interface: normalized state, diagnostics, setTarget within limits
import { normalize, diagnosticsOf } from '../src/devices/treadmill/nordictrack-exp5i/messages.js';
import { Treadmill } from '../src/devices/treadmill/treadmill.js';

test('normalize: belt, alerts and console HR from the iFit state', () => {
  assert.deepEqual(
    (({ belt, alerts, hr, hrSource }) => ({ belt, alerts, hr, hrSource }))(normalize({ mode: MODE.ACTIVE, pulse: { bpm: 128, source: 1 } })),
    { belt: 'running', alerts: [], hr: 128, hrSource: 'console' });
  assert.equal(normalize({ mode: MODE.PAUSE }).belt, 'paused');
  assert.equal(normalize({ mode: MODE.IDLE }).belt, 'stopped');
  assert.deepEqual(normalize({ mode: MODE.MISSING_SAFETY_KEY }).alerts, ['safety-key-missing']);
  const noPulse = normalize({ speed: 5, pulse: { bpm: 0, source: 0 } });
  assert.equal(noPulse.hr, null);
  assert.equal(noPulse.speed, 5);
  assert.equal('belt' in normalize({ speed: 5 }), false); // no mode reported, no belt guess
});

test('diagnostics: console mode and HR source', () => {
  assert.deepEqual(diagnosticsOf({ mode: MODE.ACTIVE, pulse: { bpm: 120, source: 1 } }), [['Mode', 'running'], ['Console HR', '120 bpm · hand grips']]);
  assert.deepEqual(diagnosticsOf({}), [['Mode', '—'], ['Console HR', '—']]);
});

test('Treadmill: setTarget clamps to the limits and rounds to their steps', () => {
  const calls = [];
  class Fake extends Treadmill {
    setSpeed(v) { calls.push(['speed', v]); }
    setIncline(v) { calls.push(['incline', v]); }
  }
  const t = new Fake({}, { capabilities: { speed: true, incline: true }, limits: { speedMin: 0.8, speedMax: 16, speedStep: 0.1, inclineMin: 0, inclineMax: 10, inclineStep: 0.5 } });
  t.setTarget({ speed: 20, incline: 3.3 });
  t.setTarget({ speed: 0.2, incline: -2 });
  t.setTarget({ speed: 8.04 });
  assert.deepEqual(calls, [['speed', 16], ['incline', 3.5], ['speed', 0.8], ['incline', 0], ['speed', 8]]);
  assert.deepEqual(t.requested, { speed: 8, incline: 0 });
  assert.deepEqual(t.diagnostics(), []);
});
