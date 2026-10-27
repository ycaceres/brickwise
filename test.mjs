// Hardware-free tests: node --test test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpeedPacket, buildInclinePacket, parseNotification, INIT_SEQUENCE, POLL_CYCLE, toHex, WRITE_HEADER,
} from './exp5i-protocol.js';
import { flattenWorkout, targetSpeedAt, formatPace, formatDuration } from './workout.js';
import { buildTcx } from './tcx.js';

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

// Real workout_doc returned by /events?resolve=true (Easy Run 9+1, Jan 29 2026)
const easyRun = {
  steps: [
    { duration: 180, warmup: true, pace: { value: 1, units: 'pace_zone' }, _pace: { start: 1.6756739616394043, end: 2.094592332839966 } },
    {
      text: '2x', duration: 1200, reps: 2, steps: [
        { duration: 540, pace: { value: 2, units: 'pace_zone' }, _pace: { start: 2.094592332839966, end: 2.370267868041992 } },
        { duration: 60, pace: { value: 1, units: 'pace_zone' }, _pace: { start: 1.6756739616394043, end: 2.094592332839966 } },
      ],
    },
    { duration: 120, warmup: true, pace: { value: 1, units: 'pace_zone' }, _pace: { start: 1.6756739616394043, end: 2.094592332839966 } },
  ],
};

test('flattenWorkout expands repeats', () => {
  const steps = flattenWorkout(easyRun);
  assert.equal(steps.length, 6);
  assert.deepEqual(steps.map((s) => s.duration), [180, 540, 60, 540, 60, 120]);
  assert.match(steps[1].label, /1\/2/);
  assert.match(steps[3].label, /2\/2/);
});

test('flattenWorkout: speed by position within the zone', () => {
  const kmh = (pos) => flattenWorkout(easyRun, { position: pos })[1].speedStart;
  assert.equal(kmh('low'), 7.5);   // 2.0946 m/s
  assert.equal(kmh('high'), 8.5);  // 2.3703 m/s
  assert.equal(kmh('mid'), 8.0);
});

test('flattenWorkout: base incline and incline from text', () => {
  const doc = { steps: [
    { duration: 60, text: 'incline 3%', _pace: { value: 2.5 } },
    { duration: 60, text: '2% incl', _pace: { value: 2.5 } },
    { duration: 60, _pace: { value: 2.5 } },
    { duration: 60, text: 'inclinación 12', _pace: { value: 2.5 } },
  ] };
  assert.deepEqual(flattenWorkout(doc, { defaultIncline: 1 }).map((s) => s.incline), [3, 2, 1, 10]);
});

test('flattenWorkout: ramps, distance and steps without a target', () => {
  const doc = { steps: [
    { duration: 300, ramp: true, _pace: { start: 2, end: 3 } },
    { distance: 1000, _pace: { value: 3 } },
    { duration: 120, hr: { units: 'hr_zone', value: 2 } },
  ] };
  const [ramp, dist, free] = flattenWorkout(doc);
  assert.equal(ramp.speedStart, 7.2);
  assert.equal(ramp.speedEnd, 10.8);
  assert.equal(targetSpeedAt(ramp, 0.5), 9);
  assert.equal(dist.distance, 1000);
  assert.equal(dist.duration, null);
  assert.equal(free.hasTarget, false);
  assert.equal(targetSpeedAt(free, 0.5), null);
});

test('formats', () => {
  assert.equal(formatPace(10), '6:00');
  assert.equal(formatPace(9.73), '6:10');
  assert.equal(formatPace(0), '--:--');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
});

test('buildTcx', () => {
  const t0 = Date.UTC(2026, 9, 25, 12, 0, 0);
  const samples = Array.from({ length: 61 }, (_, i) => ({ t: t0 + i * 1000, distance: i * 2.5, speed: 9, hr: i ? 140 : null }));
  const tcx = buildTcx(samples, { name: 'Test <A&B>' });
  assert.match(tcx, /<Activity Sport="Running">/);
  assert.match(tcx, /<TotalTimeSeconds>60<\/TotalTimeSeconds>/);
  assert.match(tcx, /<DistanceMeters>150\.0<\/DistanceMeters>/);
  assert.match(tcx, /<AverageHeartRateBpm><Value>140<\/Value>/);
  assert.match(tcx, /Test &lt;A&amp;B&gt;/);
  assert.equal((tcx.match(/<Trackpoint>/g) || []).length, 61);
  assert.throws(() => buildTcx([]));
});

// ---------------------------------------------------------------------------
// Full decoding (ifit-messages.js)
// ---------------------------------------------------------------------------
import {
  MessageAssembler, parseRequest, parseResponse, decodeReads, toStatus, MODE,
} from './ifit-messages.js';

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

import { buildWriteAndRead, buildRequest, chunkMessage } from './ifit-messages.js';

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

test('flattenWorkout: absolute pace without a zone is labeled with the pace', () => {
  const [s] = flattenWorkout({ steps: [{ duration: 5, pace: { units: 'secs/km', value: 720 }, _pace: { value: 5 / 3.6 } }] });
  assert.match(s.label, /pace 12:00\/km/);
  assert.equal(s.speedStart, 5);
});

import { paceZoneOf, hrTargetRange, hrZoneOf, zonesFromProfile, profileFromIntervals, resolveDoc } from './zones.js';

// The athlete's real running sport-settings (Oct 25 2026)
const runSettings = {
  lthr: 168, max_hr: 185,
  hr_zones: [134, 150, 158, 168, 171, 178, 185],
  threshold_pace: 2.7027,
  pace_zones: [77.5, 87.7, 94.3, 100.0, 103.4, 111.5, 999.0],
};

test('zones: HR and pace ranges', () => {
  const z = zonesFromProfile(profileFromIntervals(runSettings));
  assert.deepEqual(z.hr[1], { z: 2, name: 'Z2', lo: 135, hi: 150 });
  assert.equal(z.pace.length, 7);
  assert.equal(z.pace[6].hi, Infinity);
  assert.equal(paceZoneOf(z, 8.0), 2);       // 7.54–8.53 km/h
  assert.equal(paceZoneOf(z, 9.7), 4);       // threshold 9.73 km/h
  assert.equal(paceZoneOf(z, 14), 7);
  assert.equal(hrZoneOf(z, 160), 4);
  assert.deepEqual(hrTargetRange(z, { units: 'hr_zone', value: 2 }), { lo: 135, hi: 150 });
  assert.deepEqual(hrTargetRange(z, { units: '%lthr', start: 80, end: 90 }), { lo: 134, hi: 151 });
  assert.deepEqual(hrTargetRange(z, null, { value: 150 }), { lo: 147, hi: 153 });
});

test('flattenWorkout with zones: HR cap on pace steps and speed on HR steps', () => {
  const zones = zonesFromProfile(profileFromIntervals(runSettings));
  const doc = { steps: [
    { duration: 600, pace: { units: 'pace_zone', value: 2 }, _pace: { start: 7.6 / 3.6, end: 8.4 / 3.6 } },
    { duration: 600, hr: { units: 'hr_zone', value: 2 } },
    { duration: 60 },
  ] };
  const [pace, hr, free] = flattenWorkout(doc, { zones });
  assert.deepEqual(pace.hr, { lo: 135, hi: 150, mode: 'cap' });
  assert.equal(pace.zone, 2);
  assert.deepEqual(hr.hr, { lo: 135, hi: 150, mode: 'target' });
  assert.ok(hr.hasTarget && hr.speedStart > 7.5 && hr.speedStart < 8.6, String(hr.speedStart));
  assert.match(hr.label, /HR 135–150 \(Z2\)/);
  assert.equal(free.hr, null);
  assert.equal(free.hasTarget, false);
});

import fs from 'node:fs';
import { buildLibrary, parseDur } from './library.js';
const LIBRARY = buildLibrary(JSON.parse(fs.readFileSync(new URL('./library.json', import.meta.url), 'utf8')));

test('profile: Intervals percentages reproduce its zones and follow LTHR', () => {
  const p = profileFromIntervals(runSettings);
  assert.deepEqual(zonesFromProfile(p).hr.map((z) => z.hi), runSettings.hr_zones);
  const z = zonesFromProfile({ ...p, lthr: 160, maxHr: 180 });
  assert.equal(z.hr[3].hi, 160);            // Z4 ends at LTHR
  assert.equal(z.hr[6].hi, 180);            // the last one reaches max HR
  const est = zonesFromProfile({ ...p, lthr: null, maxHr: 190 });
  assert.equal(est.lthr, 173);              // 91 % of max HR
});

test('resolveDoc: % of threshold with the profile and the full library', () => {
  const zones = zonesFromProfile({ ...profileFromIntervals(runSettings), thresholdKmh: 10 });
  const doc = resolveDoc({ steps: [{ duration: 60, pace: { units: '%pace', value: 90 } }] }, zones);
  assert.equal(Math.round(doc.steps[0]._pace.value * 3.6 * 10) / 10, 9);
  for (const w of LIBRARY) {
    const steps = flattenWorkout(resolveDoc(w.workout_doc, zones), { zones });
    assert.ok(steps.length > 2, w.id);
    assert.ok(steps.every((s) => s.hasTarget && s.speedStart >= 0.8 && s.speedStart <= 16), w.id);
  }
  const hills = flattenWorkout(resolveDoc(LIBRARY.find((w) => w.id === 'hills-45-2').workout_doc, zones), { zones });
  assert.deepEqual([...new Set(hills.map((s) => s.incline))].sort(), [0, 1, 5]);
});

test('library: incline walk at Z2', () => {
  const zones = zonesFromProfile(profileFromIntervals(runSettings));
  const w = LIBRARY.find((x) => x.id === 'walk-incline-45-3');
  const steps = flattenWorkout(resolveDoc(w.workout_doc, zones), { zones });
  assert.equal(steps.reduce((a, s) => a + s.duration, 0), 45 * 60);
  assert.ok(steps.every((s) => s.speedStart === 5 && !s.ramp));        // fixed 12:00/km
  assert.equal(steps[0].duration, 300);
  assert.equal(steps[0].incline, 2);
  assert.deepEqual(steps.slice(1, 17).map((s) => s.incline), [2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
  assert.ok(steps.slice(1, 17).every((s) => s.duration === 60));
  assert.equal(steps.at(-1).incline, 10);
  assert.equal(steps.at(-1).duration, 24 * 60);
  // Z2 HR is the goal, but speed never changes
  assert.equal(steps[0].hr, null);
  assert.ok(steps.slice(1).every((s) => s.hr.mode === 'info' && s.hr.hi === 150));
});

import { cleanRr, dfaAlpha1, alpha1Window, alphaState } from './hrv.js';
import { parseHeartRate } from './treadmill.js';

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

test('α1: artifacts, white noise vs correlated noise', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const white = Array.from({ length: 400 }, () => 800 + (rand() - 0.5) * 60);
  let e = 0;
  const corr = Array.from({ length: 400 }, () => 800 + (e = 0.95 * e + (rand() - 0.5) * 20));
  assert.ok(dfaAlpha1(white) < 0.75, `white ${dfaAlpha1(white)}`);
  assert.ok(dfaAlpha1(corr) > 1, `correlated ${dfaAlpha1(corr)}`);

  const bad = [...white];
  for (let i = 0; i < 25; i++) bad[i * 15] = 400; // split beats (6 %)
  assert.equal(cleanRr(bad).artifacts, 25);

  // Window: above 5 % artifacts there is no value
  const beats = bad.map((rr, i) => ({ t: i * 300, rr }));
  const w = alpha1Window(beats, beats[beats.length - 1].t);
  assert.equal(w.alpha1, null);
  assert.equal(w.reason, 'noisy signal');
  assert.equal(alphaState(0.9), 'aerobic');
  assert.equal(alphaState(0.6), 'transition');
  assert.equal(alphaState(0.4), 'anaerobic');
});

test('library: every combination lasts what it says and levels go up', () => {
  assert.equal(parseDur('1m30s'), 90);
  assert.equal(parseDur('90s'), 90);
  assert.throws(() => parseDur('2 min'));
  const secs = (steps) => steps.reduce((a, s) => a + (s.steps ? s.reps * secs(s.steps) : s.duration), 0);
  const generated = LIBRARY.filter((w) => !w.featured);
  assert.equal(generated.length, 8 * 3 * 5);
  for (const w of generated) assert.equal(secs(w.workout_doc.steps), w.minutes * 60, w.id);
  // Work time grows with level in interval sessions
  const zones = zonesFromProfile(profileFromIntervals(runSettings));
  for (const type of ['tempo', 'threshold', 'vo2']) {
    for (const m of [30, 45, 60]) {
      const work = [1, 2, 3, 4, 5].map((lv) => {
        const steps = flattenWorkout(resolveDoc(LIBRARY.find((w) => w.id === `${type}-${m}-${lv}`).workout_doc, zones), { zones });
        return steps.filter((s) => s.speedStart >= zones.thresholdKmh * 0.89).reduce((a, s) => a + s.duration, 0);
      });
      for (let i = 1; i < 5; i++) assert.ok(work[i] >= work[i - 1], `${type} ${m} min: ${work}`);
    }
  }
});

import { hrDecision, hrSlope } from './hrcontrol.js';

test('HR control: aims at the middle, looks ahead, scales the correction', () => {
  const z2 = { mode: 'target', lo: 135, hi: 160, hrAdjust: 0, alphaLow: false };
  // Steady at 158 with Z2 135–160: above the middle (147.5), so it slows down by the max step
  assert.deepEqual(hrDecision({ ...z2, hr: 158, slope: 0 }).delta, -0.5);
  // On target, nothing
  assert.equal(hrDecision({ ...z2, hr: 148, slope: 0 }).delta, 0);
  // Still on target but climbing 0.2 bpm/s → projected 154 in 30 s: slow down a little already
  assert.equal(hrDecision({ ...z2, hr: 148, slope: 0.2 }).delta, -0.4);
  // Below the range: speed up
  assert.ok(hrDecision({ ...z2, hr: 138, slope: 0 }).delta > 0);
});

test('HR control: pace steps cap HR ahead of time and give the speed back', () => {
  const cap = { mode: 'cap', lo: 135, hi: 160, alphaLow: false };
  assert.equal(hrDecision({ ...cap, hr: 155, slope: 0, hrAdjust: 0 }).delta, 0);
  assert.ok(hrDecision({ ...cap, hr: 157, slope: 0.2, hrAdjust: 0 }).delta < 0);   // heading to 163
  assert.equal(hrDecision({ ...cap, hr: 150, slope: 0, hrAdjust: -0.4 }).delta, 0.4);
  assert.equal(hrDecision({ ...cap, hr: 150, slope: 0.1, hrAdjust: -0.4 }).delta, 0); // still rising
});

test('HR control: α1 below VT1 slows aerobic steps even with HR in range', () => {
  const p = { mode: 'target', lo: 135, hi: 160, hr: 147, slope: 0, hrAdjust: 0 };
  assert.equal(hrDecision({ ...p, alphaLow: false }).delta, 0);
  assert.equal(hrDecision({ ...p, alphaLow: true }).delta, -0.2);
  assert.equal(hrDecision({ ...p, hr: 130, alphaLow: true }).delta, -0.2);       // never speeds up
  assert.equal(hrDecision({ ...p, hr: 160, alphaLow: true }).delta, -0.5);       // HR correction is bigger
  assert.equal(hrSlope([1, 2, 3, 4, 5, 6].map((i) => ({ elapsed: i, hr: 140 + i }))), 1);
  assert.equal(hrSlope([{ elapsed: 1, hr: 140 }]), 0);
});

test('flattenWorkout marks warm-up steps (they end early at the top of Z1)', () => {
  const steps = flattenWorkout(LIBRARY.find((w) => w.id === 'hr-z2').workout_doc);
  assert.deepEqual(steps.map((s) => s.warmup), [true, false, false]);
  assert.equal(steps[0].ramp, true);
});
