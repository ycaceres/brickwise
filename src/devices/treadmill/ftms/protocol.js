/**
 * Bluetooth Fitness Machine Service (FTMS 1.0) for treadmills: parsing what
 * the treadmill reports and building Control Point commands. Pure: tested
 * with byte layouts from the specification. Little-endian throughout.
 */

export const SERVICE = 'fitness_machine';
export const FEATURE = 0x2acc;
export const TREADMILL_DATA = 0x2acd;
export const SPEED_RANGE = 0x2ad4;
export const INCLINE_RANGE = 0x2ad5;
export const CONTROL_POINT = 0x2ad9;
export const MACHINE_STATUS = 0x2ada;

/** Treadmill Data (0x2ACD): the fields the flags say are present, in spec order. */
export function parseTreadmillData(v) {
  const flags = v.getUint16(0, true);
  let o = 2;
  const out = {};
  const u8 = () => v.getUint8(o++);
  const u16 = () => { const x = v.getUint16(o, true); o += 2; return x; };
  const s16 = () => { const x = v.getInt16(o, true); o += 2; return x; };
  const u24 = () => { const x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16); o += 3; return x; };
  if (!(flags & 0x0001)) out.speed = u16() / 100;            // bit 0 "more data" = 0: instantaneous speed present
  if (flags & 0x0002) out.averageSpeed = u16() / 100;
  if (flags & 0x0004) out.distance = u24();                  // m
  if (flags & 0x0008) { out.incline = s16() / 10; out.rampAngle = s16() / 10; }
  if (flags & 0x0010) { out.elevationGain = u16() / 10; out.elevationLoss = u16() / 10; }
  if (flags & 0x0020) out.pace = u8() / 10;                  // km/min
  if (flags & 0x0040) out.averagePace = u8() / 10;
  if (flags & 0x0080) { out.calories = u16(); out.caloriesPerHour = u16(); out.caloriesPerMinute = u8(); }
  if (flags & 0x0100) out.hr = u8();
  if (flags & 0x0200) out.met = u8() / 10;
  if (flags & 0x0400) out.time = u16();                      // elapsed s
  if (flags & 0x0800) out.remaining = u16();
  if (flags & 0x1000) { out.force = s16(); out.power = s16(); }
  return out;
}

/** Fitness Machine Feature (0x2ACC): what it reports and which targets it accepts. */
export function parseFeatures(v) {
  const machine = v.getUint32(0, true);
  const targets = v.byteLength >= 8 ? v.getUint32(4, true) : 0;
  return {
    machine,
    targets,
    inclineReported: !!(machine & (1 << 3)),
    hrReported: !!(machine & (1 << 10)),
    speedTarget: !!(targets & (1 << 0)),
    inclineTarget: !!(targets & (1 << 1)),
  };
}

/** Supported Speed Range (0x2AD4), km/h. */
export const parseSpeedRange = (v) => ({ min: v.getUint16(0, true) / 100, max: v.getUint16(2, true) / 100, step: v.getUint16(4, true) / 100 });

/** Supported Inclination Range (0x2AD5), %. */
export const parseInclineRange = (v) => ({ min: v.getInt16(0, true) / 10, max: v.getInt16(2, true) / 10, step: v.getUint16(4, true) / 10 });

const bytes = (...b) => Uint8Array.from(b);
const le16 = (x) => [x & 0xff, (x >> 8) & 0xff];

export const OP = { REQUEST_CONTROL: 0x00, RESET: 0x01, SPEED: 0x02, INCLINE: 0x03, START: 0x07, STOP_PAUSE: 0x08, RESPONSE: 0x80 };
export const requestControl = () => bytes(OP.REQUEST_CONTROL);
export const setTargetSpeed = (kmh) => bytes(OP.SPEED, ...le16(Math.round(kmh * 100)));
export const setTargetIncline = (pct) => bytes(OP.INCLINE, ...le16(Math.round(pct * 10) & 0xffff));
export const startOrResume = () => bytes(OP.START);
export const stopOrPause = (pause = true) => bytes(OP.STOP_PAUSE, pause ? 2 : 1);

const RESULTS = { 1: 'success', 2: 'not supported', 3: 'invalid parameter', 4: 'failed', 5: 'control not permitted' };

/** Control Point indication: [0x80, request opcode, result]. */
export function parseControlResponse(v) {
  if (v.getUint8(0) !== OP.RESPONSE) return null;
  const result = v.getUint8(2);
  return { opcode: v.getUint8(1), result, ok: result === 1, text: RESULTS[result] ?? `code ${result}` };
}

/** Fitness Machine Status (0x2ADA): what changed on the machine itself. */
export function parseMachineStatus(v) {
  const op = v.getUint8(0);
  switch (op) {
    case 0x01: return { event: 'reset' };
    case 0x02: return { event: 'stopped', belt: v.byteLength > 1 && v.getUint8(1) === 2 ? 'paused' : 'stopped' };
    case 0x03: return { event: 'stopped', belt: 'stopped' };   // stopped by safety key
    case 0x04: return { event: 'started', belt: 'running' };
    case 0x05: return { event: 'target-speed', targetSpeed: v.getUint16(1, true) / 100 };
    case 0x06: return { event: 'target-incline', targetIncline: v.getInt16(1, true) / 10 };
    case 0xff: return { event: 'control-lost' };
    default: return { event: `status ${op}` };
  }
}
