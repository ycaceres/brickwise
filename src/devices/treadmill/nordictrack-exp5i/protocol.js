/**
 * iFit BLE protocol for the NordicTrack EXP 5i.
 *
 * Every sequence comes from qdomyos-zwift's `nordictrack_treadmill_exp_5i`
 * profile (src/devices/proformtreadmill/proformtreadmill.cpp), which was built
 * from a real HCI capture of an EXP 5i (issue #2502).
 *
 * Message format (before splitting into 20-byte packets):
 *   02 04 02 | LL | EE | LL | CC | PAYLOAD | SS
 *   LL = length, EE = equipment (02 general, 04 treadmill), CC = command,
 *   SS = low byte of EE + LL + CC + PAYLOAD.
 * Each message is preceded by a `fe 02 <length> <n packets>` header.
 */

export const SERVICE_UUID = '00001533-1412-efde-1523-785feabcd123';
export const WRITE_UUID = '00001534-1412-efde-1523-785feabcd123';
export const NOTIFY_UUID = '00001535-1412-efde-1523-785feabcd123';

export const LIMITS = {
  speedMin: 0.8,   // km/h, lowest useful speed with the belt moving
  speedMax: 16.0,  // km/h (EXP 5i: 0–16 km/h)
  inclineMin: 0,
  inclineMax: 10,  // % (EXP 5i: 0–10 %)
};

// Delay between init packets (qdomyos-zwift: 400 ms on macOS/Linux, 600 ms on Windows)
export const INIT_DELAY_MS = 400;
// Polling cycle: one packet every 200 ms, 6 steps
export const POLL_INTERVAL_MS = 200;
// Max wait for a notification response
export const RESPONSE_TIMEOUT_MS = 300;

const b = (...bytes) => Uint8Array.from(bytes);

// ---------------------------------------------------------------------------
// Init and enable (btinit, nordictrack_treadmill_exp_5i branch)
// ---------------------------------------------------------------------------
const I1 = b(0xfe, 0x02, 0x08, 0x02);
const I2 = b(0xff, 0x08, 0x02, 0x04, 0x02, 0x04, 0x02, 0x04, 0x81, 0x87, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); // 0x81 equipment info
const I3 = b(0xff, 0x08, 0x02, 0x04, 0x02, 0x04, 0x04, 0x04, 0x80, 0x88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); // 0x80 capabilities
const I4 = b(0xff, 0x08, 0x02, 0x04, 0x02, 0x04, 0x04, 0x04, 0x88, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); // 0x88 commands
const I5 = b(0xfe, 0x02, 0x0a, 0x02);
const I6 = b(0xff, 0x0a, 0x02, 0x04, 0x02, 0x06, 0x02, 0x06, 0x82, 0x00, 0x00, 0x8a, 0, 0, 0, 0, 0, 0, 0, 0); // 0x82 reference
const I7 = b(0xff, 0x0a, 0x02, 0x04, 0x02, 0x06, 0x02, 0x06, 0x84, 0x00, 0x00, 0x8c, 0, 0, 0, 0, 0, 0, 0, 0); // 0x84 firmware
const I8 = b(0xff, 0x08, 0x02, 0x04, 0x02, 0x04, 0x02, 0x04, 0x95, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); // 0x95 serial number
// 0x90 ENABLE: 36-byte activation code split over 3 packets
const I9 = b(0xfe, 0x02, 0x2c, 0x04);
const I10 = b(0x00, 0x12, 0x02, 0x04, 0x02, 0x28, 0x04, 0x28, 0x90, 0x07, 0xe0, 0xd5, 0xc8, 0xc1, 0xb8, 0xbd, 0xb0, 0xb1, 0xb0, 0xb5);
const I11 = b(0x01, 0x12, 0xc8, 0xc1, 0xd8, 0xed, 0xe0, 0x11, 0x00, 0x35, 0x28, 0x41, 0x78, 0x9d, 0xb0, 0xd1, 0xf0, 0x15, 0x28, 0x41);
const I12 = b(0xff, 0x08, 0x98, 0xad, 0xc0, 0xa0, 0x02, 0x00, 0x00, 0xc4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const N1 = b(0xfe, 0x02, 0x17, 0x03);
const N2 = b(0x00, 0x12, 0x02, 0x04, 0x02, 0x13, 0x04, 0x13, 0x02, 0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const N3 = b(0xff, 0x05, 0x00, 0x80, 0x00, 0x00, 0xa5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const N4 = b(0xfe, 0x02, 0x19, 0x03);
const N5 = b(0x00, 0x12, 0x02, 0x04, 0x02, 0x15, 0x04, 0x15, 0x02, 0x0e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const N6 = b(0xff, 0x07, 0x00, 0x00, 0x00, 0x10, 0x01, 0x00, 0x3a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
const N7 = b(0x00, 0x12, 0x02, 0x04, 0x02, 0x15, 0x04, 0x15, 0x02, 0x00, 0x0f, 0x00, 0x10, 0x00, 0xd8, 0x1c, 0x48, 0x00, 0x00, 0xe0);
const N8 = b(0xff, 0x07, 0x00, 0x00, 0x00, 0x10, 0x00, 0x08, 0x6e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

export const INIT_SEQUENCE = [
  I1, I2, I1, I3, I1, I4, I5, I6, I5, I7, I1, I8, I9, I10, I11, I12,
  N1, N2, N3, N4, N5, N6, N4, N7, N8,
];

// ---------------------------------------------------------------------------
// Polling cycle (update(), proform_8_5_treadmill || nordictrack_treadmill_exp_5i branch)
// Step 2 waits for the response; speed and incline are applied after it.
// ---------------------------------------------------------------------------
export const POLL_CYCLE = [
  { data: b(0xfe, 0x02, 0x19, 0x03), waitResponse: false },
  { data: b(0x00, 0x12, 0x02, 0x04, 0x02, 0x15, 0x04, 0x15, 0x02, 0x00, 0x0f, 0x80, 0x08, 0x40, 0, 0, 0, 0, 0, 0), waitResponse: false },
  { data: b(0xff, 0x07, 0x00, 0x00, 0x00, 0x80, 0x00, 0x10, 0x82, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), waitResponse: true, applyRequests: true },
  { data: b(0xfe, 0x02, 0x17, 0x03), waitResponse: false },
  { data: b(0x00, 0x12, 0x02, 0x04, 0x02, 0x13, 0x04, 0x13, 0x02, 0x00, 0x0d, 0x13, 0x96, 0x31, 0x00, 0x00, 0x40, 0x10, 0x00, 0x80), waitResponse: false },
  { data: b(0xff, 0x05, 0x18, 0x00, 0x00, 0x01, 0xe9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), waitResponse: false },
];

// Header before each speed/incline command (13-byte message, 2 packets)
export const WRITE_HEADER = b(0xfe, 0x02, 0x0d, 0x02);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * WRITE_AND_READ command with a uint16 LE value (x100).
 * selector 0x01 = speed (km/h), 0x02 = incline (%).
 * Checksum = EE(04) + LL(09) + CC(02) + 01 + selector + lo + hi
 *          = lo + hi + 0x10 + selector  → 0x11 for speed, 0x12 for incline.
 */
function buildWrite(selector, value) {
  const raw = Math.round(value * 100);
  const lo = raw & 0xff;
  const hi = (raw >> 8) & 0xff;
  const pkt = b(0xff, 0x0d, 0x02, 0x04, 0x02, 0x09, 0x04, 0x09, 0x02, 0x01,
                selector, lo, hi, 0x00, 0x00, 0, 0, 0, 0, 0);
  pkt[14] = (lo + hi + 0x10 + selector) & 0xff;
  return pkt;
}

export function buildSpeedPacket(kmh) {
  return buildWrite(0x01, clamp(kmh, 0, LIMITS.speedMax));
}

export function buildInclinePacket(percent) {
  return buildWrite(0x02, clamp(percent, LIMITS.inclineMin, LIMITS.inclineMax));
}

/**
 * Decodes a notification. Returns {speed, incline, watts} or null if the
 * packet is not the status one (characteristicChanged filter for the EXP 5i:
 * 20 bytes starting with 00 12 01 04 02 2e).
 */
export function parseNotification(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (d.length !== 20) return null;
  if (d[0] !== 0x00 || d[1] !== 0x12 || d[2] !== 0x01 || d[3] !== 0x04 || d[4] !== 0x02 || d[5] !== 0x2e) return null;
  if (d.slice(12).every((x) => x === 0xff)) return null;

  const watts = d[14] | (d[15] << 8);
  // qdomyos-zwift drops speed/incline when this field exceeds 3000
  if (watts > 3000) return null;

  const speed = (d[10] | (d[11] << 8)) / 100;
  const inclineRaw = d[12] | (d[13] << 8);
  const incline = (inclineRaw > 0x7fff ? inclineRaw - 0x10000 : inclineRaw) / 100;
  return { speed, incline, watts };
}

export const toHex = (data) =>
  Array.from(data, (x) => x.toString(16).padStart(2, '0')).join(' ');
