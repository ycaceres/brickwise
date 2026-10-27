/** Standard Bluetooth heart rate strap (Heart Rate service 0x180D), shared by every device. */

const noop = () => {};

/**
 * Reads a Heart Rate service measurement (0x2A37): heart rate, skin contact
 * and RR intervals (in 1/1024 s, returned in ms).
 * @param {DataView} v
 */
export function parseHeartRate(v) {
  const flags = v.getUint8(0);
  const wide = flags & 0x01;
  const bpm = wide ? v.getUint16(1, true) : v.getUint8(1);
  // Bit 2: the strap reports contact; bit 1: contact present
  const contact = flags & 0x04 ? !!(flags & 0x02) : null;
  let offset = wide ? 3 : 2;
  if (flags & 0x08) offset += 2; // energy expended
  const rr = [];
  if (flags & 0x10) {
    for (; offset + 1 < v.byteLength; offset += 2) rr.push(Math.round((v.getUint16(offset, true) / 1024) * 1000));
  }
  return { bpm, contact, rr };
}

/** Standard heart rate strap (Heart Rate service 0x180D). */
export class HeartRateStrap {
  constructor({ onHr = noop, onStatus = noop, onRr = noop } = {}) {
    Object.assign(this, { onHr, onStatus, onRr });
    this.contact = null;
    this.bpm = null;
    this.device = null;
  }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    this.device.addEventListener('gattserverdisconnected', () => {
      this.bpm = null;
      this.onStatus('disconnected');
    });
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const ch = await service.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', (e) => {
      const m = parseHeartRate(e.target.value);
      this.bpm = m.bpm;
      this.contact = m.contact;
      this.onHr(this.bpm);
      if (m.rr.length) this.onRr(m.rr, m.contact);
    });
    await ch.startNotifications();
    this.onStatus('ready', this.device.name);
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }
}
