/**
 * Full decoding of iFit messages.
 *
 * Based on ianchi/ifit (ifit/client/protocol.py): characteristics table,
 * packet assembly and response format.
 *
 * Full message (request or response), before splitting into packets:
 *   [0..2] 02 04 02 (request) / 01 04 02 (response)
 *   [3]    LL  → total length = LL + 4
 *   [4]    equipment   [5] LL   [6] command
 *   request:  [7..] payload, last byte checksum = sum([4..-1])
 *   response: [7] status (2 = OK), [8..] values, last byte checksum
 *
 * BLE packets: header `fe 02 <length> <n packets>`, then packets
 * `<index> <length> <up to 18 bytes>`; the last one has index ff.
 *
 * WRITE_AND_READ (0x02) payload: write bitmap, written values (in id order),
 * read bitmap. Bitmap = <n bytes> + bytes, bit k of byte i = characteristic
 * i*8+k. The response carries the read values in id order, from byte 8.
 */

export const COMMANDS = {
  0x02: 'WRITE_AND_READ',
  0x06: 'CALIBRATE',
  0x80: 'SUPPORTED_CAPABILITIES',
  0x81: 'EQUIPMENT_INFORMATION',
  0x82: 'EQUIPMENT_REFERENCE',
  0x84: 'EQUIPMENT_FIRMWARE',
  0x88: 'SUPPORTED_COMMANDS',
  0x90: 'ENABLE',
  0x95: 'EQUIPMENT_SERIAL',
};

export const MODES = {
  0: 'unknown',
  1: 'idle',
  2: 'running',
  3: 'paused',
  4: 'summary',
  7: 'settings',
  8: 'safety key missing',
  10: 'warm-up',
};
export const MODE = { IDLE: 1, ACTIVE: 2, PAUSE: 3, SUMMARY: 4, MISSING_SAFETY_KEY: 8, WARMUP: 10 };

export const PULSE_SOURCES = { 0: 'none', 1: 'hand grips', 2: 'unknown', 3: 'unknown', 4: 'Bluetooth strap' };

const u = (size) => (b, p) => {
  let v = 0;
  for (let i = size - 1; i >= 0; i--) v = v * 256 + b[p + i];
  return v;
};
const hundredths = (b, p) => u(2)(b, p) / 100;
const hex = (b, p, size) => Array.from(b.slice(p, p + size), (x) => x.toString(16).padStart(2, '0')).join('');

/** id → [name, size in bytes, decoder]. Sizes from ianchi/ifit. */
const C = (name, size, decode) => ({ name, size, decode: decode || ((b, p) => (size <= 4 ? u(size)(b, p) : hex(b, p, size))) });
export const CHARACTERISTICS = {
  0: C('Kph', 2, hundredths),
  1: C('Incline', 2, (b, p) => { const v = u(2)(b, p); return (v > 0x7fff ? v - 0x10000 : v) / 100; }),
  3: C('Unknown3', 2),
  4: C('CurrentDistance', 4),
  6: C('Distance', 4),
  7: C('Unknown7', 14),
  8: C('Unknown8', 1),
  9: C('Volume', 1),
  10: C('Pulse', 4, (b, p) => ({ bpm: b[p], avg: b[p + 1], count: b[p + 2], source: b[p + 3] })),
  11: C('UpTime', 4),
  12: C('Mode', 1),
  13: C('Calories', 4, (b, p) => u(4)(b, p) / (100000000 / 1024)),
  14: C('Unknown14', 3),
  15: C('Unknown15', 2),
  16: C('CurrentKph', 2, hundredths),
  17: C('CurrentIncline', 2, hundredths),
  19: C('Unknown19', 4),
  20: C('CurrentTime', 4),
  21: C('CurrentCalories', 4, (b, p) => u(4)(b, p) / (100000000 / 1024)),
  22: C('Unknown22', 4),
  23: C('Unknown23', 4),
  24: C('Unknown24', 1),
  25: C('Unknown25', 2),
  27: C('MaxIncline', 2, hundredths),
  28: C('MinIncline', 2, hundredths),
  30: C('MaxKph', 2, hundredths),
  31: C('MinKph', 2, hundredths),
  34: C('X1', 2),
  35: C('X2', 2),
  36: C('Metric', 1, (b, p) => b[p] === 1),
  37: C('Unknown37', 1),
  41: C('Unknown41', 2),
  43: C('X3', 2, hundredths),
  44: C('Unknown44', 4),
  45: C('WarmupCountdown', 2),
  46: C('X4', 2),
  47: C('Unknown47', 4),
  48: C('Unknown48', 4),
  49: C('MaxPulse', 1),
  51: C('MaxKphSession', 2, hundredths),
  52: C('AvgInclineSession', 2, hundredths),
  53: C('MaxInclineSession', 2, hundredths),
  54: C('Unknown54', 2),
  55: C('Unknown55', 2),
  58: C('Unknown58', 2),
  59: C('Unknown59', 2),
  64: C('Unknown64', 4),
  65: C('Unknown65', 1),
  66: C('Unknown66', 4),
  69: C('X5', 4),
  70: C('TotalTime', 4),
  71: C('X6', 2),
  72: C('EffortLevel', 2),
  73: C('Unknown73', 4),
  74: C('Unknown74', 4),
  75: C('Unknown75', 4),
  76: C('Unknown76', 4),
  83: C('Unknown83', 2),
  84: C('Unknown84', 2),
  85: C('Unknown85', 2),
  94: C('Unknown94', 4),
  100: C('X7', 1),
  103: C('PausedTime', 4),
};

/**
 * Reassembles a message's BLE packets (works for both what we send and what
 * we receive). push() returns the full message or null.
 */
export class MessageAssembler {
  constructor() {
    this.reset();
  }

  reset() {
    this.buffer = null;
    this.chunks = 0;
  }

  push(data) {
    const d = data instanceof Uint8Array ? data : Uint8Array.from(data);
    if (!d.length) return null;
    if (d[0] === 0xfe && d.length >= 4) {
      this.buffer = new Uint8Array(d[2]);
      this.chunks = d[3] - 1;
      return null;
    }
    if (!this.buffer || d.length < 2) return null;
    const index = d[0];
    if (index !== 0xff && index >= this.chunks) {
      this.reset();
      throw new Error(`packet ${index} out of range (${this.chunks} expected)`);
    }
    const pos = (index === 0xff ? this.chunks - 1 : index) * 18;
    const len = d[1];
    if (pos + len > this.buffer.length) {
      this.reset();
      throw new Error(`packet exceeds message length (${pos + len} > ${this.buffer.length})`);
    }
    this.buffer.set(d.slice(2, 2 + len), pos);
    if (index !== 0xff) return null;
    const msg = this.buffer;
    this.reset();
    return msg;
  }
}

// ---------------------------------------------------------------------------
// Building requests (ifit's build_request / build_write_messages)
// ---------------------------------------------------------------------------

/** 02 04 02 LL EE LL CC payload SS, with LL = payload + 4. */
export function buildRequest(equipment, command, payload = []) {
  const len = payload.length + 4;
  const msg = [0x02, 0x04, 0x02, len, equipment, len, command, ...payload, 0];
  msg[msg.length - 1] = msg.slice(4, -1).reduce((a, x) => a + x, 0) & 0xff;
  return Uint8Array.from(msg);
}

/** Splits a message into the fe 02 … header and 20-byte packets (the last with index ff). */
export function chunkMessage(msg) {
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

function bitmap(ids) {
  if (!ids.length) return [0];
  const n = Math.floor(Math.max(...ids) / 8) + 1;
  const bytes = new Array(n).fill(0);
  for (const id of ids) bytes[Math.floor(id / 8)] |= 1 << (id % 8);
  return [n, ...bytes];
}

const ENCODERS = {
  hundredths: (v) => { const r = Math.round(v * 100) & 0xffff; return [r & 0xff, r >> 8]; },
  byte: (v) => [v & 0xff],
};
const WRITABLE = { 0: ENCODERS.hundredths, 1: ENCODERS.hundredths, 12: ENCODERS.byte };

/**
 * WRITE_AND_READ to the treadmill: writes = {id: value} (only 0 Kph, 1 Incline,
 * 12 Mode), reads = [ids]. Returns the BLE packets ready to send.
 */
export function buildWriteAndRead(writes = {}, reads = [], equipment = 0x04) {
  const ids = Object.keys(writes).map(Number).sort((a, b) => a - b);
  const values = ids.flatMap((id) => {
    if (!WRITABLE[id]) throw new Error(`Don't know how to write characteristic ${id}`);
    return WRITABLE[id](writes[id]);
  });
  const payload = [...bitmap(ids), ...values, ...bitmap([...reads].sort((a, b) => a - b))];
  return chunkMessage(buildRequest(equipment, 0x02, payload));
}

const checksumOk = (msg) => (msg.slice(4, -1).reduce((a, x) => a + x, 0) & 0xff) === msg[msg.length - 1];

function readBitmap(bytes, pos) {
  const n = bytes[pos];
  const ids = [];
  for (let i = 0; i < n; i++) {
    const byte = bytes[pos + 1 + i];
    for (let bit = 0; bit < 8; bit++) if (byte & (1 << bit)) ids.push(i * 8 + bit);
  }
  return { ids, next: pos + 1 + n };
}

/** Decodes one of our requests: command and, for WRITE_AND_READ, what is written and read. */
export function parseRequest(msg) {
  if (msg.length < 8 || msg[0] !== 0x02 || msg[1] !== 0x04 || msg[2] !== 0x02) return null;
  const req = { equipment: msg[4], command: msg[6], name: COMMANDS[msg[6]] || `0x${msg[6].toString(16)}`, checksumOk: checksumOk(msg) };
  if (msg[6] === 0x02) {
    const body = msg.slice(7, -1);
    const writes = readBitmap(body, 0);
    let pos = writes.next;
    const writeValues = {};
    for (const id of writes.ids) {
      const c = CHARACTERISTICS[id];
      if (!c) break;
      writeValues[c.name] = c.decode(body, pos);
      pos += c.size;
    }
    req.writeValues = writeValues;
    req.readIds = pos < body.length ? readBitmap(body, pos).ids : [];
  }
  return req;
}

/** Values of a WRITE_AND_READ response, in the order of the requested ids. */
export function decodeReads(msg, readIds) {
  const values = {};
  const unknown = [];
  let pos = 8;
  const end = msg.length - 1; // checksum
  for (let i = 0; i < readIds.length; i++) {
    const id = readIds[i];
    const c = CHARACTERISTICS[id];
    const isLast = i === readIds.length - 1;
    if (!c) {
      // Unknown size: can only be inferred if it is the last one
      if (isLast && end > pos) {
        values[`Unknown${id}`] = hex(msg, pos, end - pos);
        unknown.push(id);
        pos = end;
        continue;
      }
      return { values, unknown: [...unknown, ...readIds.slice(i)], complete: false, leftover: end - pos };
    }
    if (pos + c.size > end) return { values, unknown, complete: false, leftover: end - pos };
    values[c.name] = c.decode(msg, pos);
    pos += c.size;
  }
  return { values, unknown, complete: pos === end, leftover: end - pos };
}

/** Decodes a response according to the request that triggered it. */
export function parseResponse(msg, request) {
  if (msg.length < 8 || msg[1] !== 0x04 || msg[2] !== 0x02) return null;
  const res = {
    equipment: msg[4],
    command: msg[6],
    name: COMMANDS[msg[6]] || `0x${msg[6].toString(16)}`,
    status: msg[7],
    ok: msg[7] === 2,
    checksumOk: checksumOk(msg),
    lengthOk: msg.length === msg[3] + 4,
  };
  if (!res.ok) return res;

  switch (msg[6]) {
    case 0x02:
      if (request?.command === 0x02) Object.assign(res, decodeReads(msg, request.readIds || []));
      break;
    case 0x81: { // supported characteristics: bitmap from byte 16
      if (msg.length > 17) res.supported = readBitmap(msg, 16).ids;
      break;
    }
    case 0x80:
    case 0x88:
      if (msg.length > 9) res.list = Array.from(msg.slice(9, 9 + msg[8]));
      break;
    case 0x82:
      if (msg.length >= 19) res.reference = u(4)(msg, 15);
      break;
    case 0x84:
      if (msg.length >= 12) res.firmware = new TextDecoder('ascii').decode(msg.slice(11, -1)).split(/[\x00\x01]/)[0].trim();
      break;
    case 0x95:
      if (msg.length >= 10) res.serial = new TextDecoder('ascii').decode(msg.slice(9, 9 + msg[8])).trim();
      break;
    default:
      break;
  }
  return res;
}

/**
 * Sums up a read's values into the state the page uses.
 * Only includes what came in the response.
 */
export function toStatus(values) {
  const s = {};
  // Actual speed (16). If it is 0 while the console is running, the requested
  // one (0) is used, which is what qdomyos-zwift reads as speed.
  const active = values.Mode === MODE.ACTIVE || !('Mode' in values);
  if ('CurrentKph' in values && (values.CurrentKph > 0 || !active || !values.Kph)) {
    s.speed = values.CurrentKph;
    s.speedSource = 'real';
  } else if ('Kph' in values) {
    s.speed = active ? values.Kph : 0;
    s.speedSource = 'requested';
  }
  if ('Kph' in values) s.targetSpeed = values.Kph;
  if ('CurrentIncline' in values) s.incline = values.CurrentIncline;
  else if ('Incline' in values) s.incline = values.Incline;
  if ('Mode' in values) s.mode = values.Mode;
  if ('Pulse' in values) s.pulse = values.Pulse;
  if ('CurrentDistance' in values) s.distance = values.CurrentDistance;
  if ('CurrentTime' in values) s.time = values.CurrentTime;
  if ('CurrentCalories' in values) s.calories = values.CurrentCalories;
  if ('UpTime' in values) s.upTime = values.UpTime;
  if ('PausedTime' in values) s.pausedTime = values.PausedTime;
  return s;
}
