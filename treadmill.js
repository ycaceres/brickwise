/**
 * Connection to the EXP 5i over Web Bluetooth, and a simulator with the same interface.
 *
 * Events (constructor callbacks):
 *   onStatus(state, detail)  'connecting' | 'initializing' | 'ready' | 'disconnected' | 'error'
 *   onData(state)            {speed, incline, targetSpeed, mode, pulse, distance, time, calories, …}
 *   onInfo(info)             {supported, firmware, serial, reference, capabilities, commands}
 *   onLog(direction, text)   'tx' | 'rx' | 'info' | 'warn' | 'error'
 */

import { RrSimulator } from './hrv.js';
import {
  SERVICE_UUID, WRITE_UUID, NOTIFY_UUID, INIT_SEQUENCE, INIT_DELAY_MS, POLL_CYCLE,
  POLL_INTERVAL_MS, RESPONSE_TIMEOUT_MS, WRITE_HEADER, LIMITS,
  buildSpeedPacket, buildInclinePacket, parseNotification, toHex,
} from './exp5i-protocol.js';
import {
  MessageAssembler, parseRequest, parseResponse, toStatus, buildWriteAndRead, MODES, MODE,
} from './ifit-messages.js';
import { sleep, every } from './timer.js';

const noop = () => {};

// If the treadmill has not moved at all this long after sending a value, it is resent
const VERIFY_AFTER_MS = 2500;
const MAX_RETRIES = 2;

class Requests {
  constructor() {
    this.speed = this._empty();
    this.incline = this._empty();
    this.mode = null; // mode to write (pause)
  }
  _empty() {
    return { pending: null, sent: null, sentAt: 0, before: null, retries: 0 };
  }
}

export class Exp5iTreadmill {
  constructor({ onStatus = noop, onData = noop, onInfo = noop, onLog = noop } = {}) {
    Object.assign(this, { onStatus, onData, onInfo, onLog });
    this.device = null;
    this.writeChar = null;
    this.notifyChar = null;
    this.state = { speed: 0, incline: 0, watts: 0, updatedAt: 0 };
    this.req = new Requests();
    this.running = false;
    this._responseWaiter = null;
    this.simulated = false;
    this.info = {};
    this.limits = {};
    this._tx = new MessageAssembler();
    this._rx = new MessageAssembler();
    this._pending = [];          // full requests waiting for a response
    this._fullDecode = false;    // true once a status response decodes fully
  }

  get connected() {
    return !!this.device?.gatt?.connected && this.running;
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error('This browser has no Web Bluetooth. Use Chrome or Edge over HTTPS or localhost.');
    }
    this.onStatus('connecting');
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'I_' }, { services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });
    this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());
    this.onLog('info', `Device: ${this.device.name || '(unnamed)'}`);

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.writeChar = await service.getCharacteristic(WRITE_UUID);
    this.notifyChar = await service.getCharacteristic(NOTIFY_UUID);
    this.notifyChar.addEventListener('characteristicvaluechanged', (e) => this._onNotify(e));
    await this.notifyChar.startNotifications();

    const p = this.writeChar.properties;
    this._writeFn = p.write
      ? (d) => this.writeChar.writeValueWithResponse(d)
      : (d) => this.writeChar.writeValueWithoutResponse(d);
    this.onLog('info', `Writes ${p.write ? 'with' : 'without'} response`);

    this.onStatus('initializing');
    await this._init();
    this.running = true;
    this.onStatus('ready', this.device.name);
    this._pollLoop();
  }

  disconnect() {
    this.running = false;
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    else this._onDisconnected();
  }

  /**
   * Requests a speed (km/h). It is sent on the next polling step that allows it.
   * The EXP 5i rejects Kph=0 (status 4), so 0 becomes a pause.
   */
  setSpeed(kmh) {
    if (kmh <= 0) return this.pause();
    const lim = this.limits;
    const lo = lim.minKph ?? 0;
    const hi = Math.min(LIMITS.speedMax, lim.maxKph ?? LIMITS.speedMax);
    const v = Math.round(Math.min(hi, Math.max(lo, kmh)) * 10) / 10;
    Object.assign(this.req.speed, { pending: v, retries: 0 });
  }

  setIncline(pct) {
    const lim = this.limits;
    const lo = Math.max(LIMITS.inclineMin, lim.minIncline ?? LIMITS.inclineMin);
    const hi = Math.min(LIMITS.inclineMax, lim.maxIncline ?? LIMITS.inclineMax);
    const v = Math.round(Math.min(hi, Math.max(lo, pct)) * 2) / 2;
    Object.assign(this.req.incline, { pending: v, retries: 0 });
  }

  /** Pauses the belt like the console's pause button (Mode = 3), as ifit does. */
  pause() {
    this.req.mode = MODE.PAUSE;
    this.req.speed.pending = null;
    this.req.speed.sent = null;
  }

  /**
   * Pauses without waiting for the polling cycle, for when the page closes:
   * requests it the normal way and also writes the message right away. The
   * direct write may collide with an ongoing poll; if it fails, the normal
   * request remains (if the page lives long enough).
   */
  pauseNow() {
    this.pause();
    if (!this.writeChar) return;
    const packets = buildWriteAndRead({ 12: MODE.PAUSE });
    this.onLog('info', 'Page closing: immediate pause');
    packets.reduce((p, pkt) => p.then(() => this._writeFn(pkt)), Promise.resolve()).catch(() => {});
  }

  // --- internals --------------------------------------------------------------

  async _init() {
    this.onLog('info', `Init and enable sequence (${INIT_SEQUENCE.length} packets)…`);
    for (const pkt of INIT_SEQUENCE) {
      await this._write(pkt, false, 'init');
      await sleep(INIT_DELAY_MS);
    }
    this.onLog('info', 'Init complete');
    // Equipment limits: 27 MaxIncline, 28 MinIncline, 30 MaxKph, 31 MinKph
    await this._sendMessage(buildWriteAndRead({}, [27, 28, 30, 31]), 'limits');
  }

  /** Sends a message already split into packets; waits for the response on the last one. */
  async _sendMessage(packets, tag) {
    for (let i = 0; i < packets.length; i++) {
      await this._write(packets[i], i === packets.length - 1, tag);
    }
  }

  async _pollLoop() {
    let slot = 0;
    while (this.running) {
      const t0 = performance.now();
      const step = POLL_CYCLE[slot];
      try {
        await this._write(step.data, step.waitResponse, 'poll');
        if (step.applyRequests) await this._applyRequests();
      } catch (err) {
        this.onLog('error', `Polling error: ${err.message}`);
        if (!this.device?.gatt?.connected) break;
      }
      slot = (slot + 1) % POLL_CYCLE.length;
      await sleep(Math.max(0, POLL_INTERVAL_MS - (performance.now() - t0)));
    }
  }

  async _applyRequests() {
    if (this.req.mode != null) {
      const mode = this.req.mode;
      this.req.mode = null;
      await this._sendMessage(buildWriteAndRead({ 12: mode }), `mode ${MODES[mode] || mode}`);
    }
    const fresh = Date.now() - this.state.updatedAt < 2000;
    this._verify(this.req.incline, this.state.incline, 0.25, 'incline');
    // If the console already reports the sent speed as requested, the command took effect
    const spdSent = this.req.speed.sent;
    if (spdSent != null && this.state.targetSpeed != null && Math.abs(this.state.targetSpeed - spdSent) < 0.05) {
      this.req.speed.sent = null;
    }
    this._verify(this.req.speed, this.state.speed, 0.15, 'speed');

    const inc = this.req.incline;
    if (inc.pending != null) {
      const target = inc.pending;
      inc.pending = null;
      if (!fresh || Math.abs(target - this.state.incline) >= 0.25) {
        await this._write(WRITE_HEADER, false, 'incline');
        await this._write(buildInclinePacket(target), true, `incline ${target}%`);
        Object.assign(inc, { sent: target, sentAt: Date.now(), before: this.state.incline });
      }
    }

    const spd = this.req.speed;
    if (spd.pending != null) {
      const target = spd.pending;
      spd.pending = null;
      if (!fresh || Math.abs(target - this.state.speed) >= 0.05) {
        await this._write(WRITE_HEADER, false, 'speed');
        await this._write(buildSpeedPacket(target), true, `speed ${target} km/h`);
        Object.assign(spd, { sent: target, sentAt: Date.now(), before: this.state.speed });
      }
    }
  }

  /** Resends if the treadmill did not react (did not even start changing). */
  _verify(r, current, tolerance, label) {
    if (r.sent == null || r.pending != null || Date.now() - r.sentAt < VERIFY_AFTER_MS) return;
    const reached = Math.abs(current - r.sent) < tolerance;
    const moved = Math.abs(current - r.before) >= tolerance / 2;
    if (reached || moved) {
      r.sent = null;
      return;
    }
    // With the console not "running" the belt does not follow speed: no point retrying
    const mode = this.state.mode;
    if (mode != null && mode !== MODE.ACTIVE && label === 'speed') {
      this.onLog('warn', `The console is "${MODES[mode] || mode}": press START so the belt follows speed ${r.sent}`);
      r.sent = null;
      return;
    }
    if (r.retries < MAX_RETRIES) {
      r.retries += 1;
      r.pending = r.sent;
      this.onLog('warn', `No response to ${label} ${r.sent}; retry ${r.retries}/${MAX_RETRIES}`);
    } else {
      this.onLog('warn', `The treadmill ignored ${label} ${r.sent}. Is the belt moving?`);
      r.sent = null;
    }
  }

  async _write(data, waitResponse, tag) {
    if (!this.writeChar) throw new Error('Not connected');
    let waiter = null;
    if (waitResponse) {
      waiter = new Promise((resolve) => {
        const timer = setTimeout(() => { this._responseWaiter = null; resolve(false); }, RESPONSE_TIMEOUT_MS);
        this._responseWaiter = () => { clearTimeout(timer); this._responseWaiter = null; resolve(true); };
      });
    }
    this.onLog('tx', `${toHex(data)}  // ${tag}`);
    this._trackRequest(data);
    await Promise.race([this._writeFn(data), sleep(RESPONSE_TIMEOUT_MS)]);
    if (waiter) await waiter;
  }

  _onNotify(event) {
    const bytes = new Uint8Array(event.target.value.buffer.slice(
      event.target.value.byteOffset, event.target.value.byteOffset + event.target.value.byteLength));
    this.onLog('rx', toHex(bytes));

    // Fallback until full decoding works: read the first packet directly,
    // like qdomyos-zwift
    if (!this._fullDecode) {
      const parsed = parseNotification(bytes);
      if (parsed) this._publish({ speed: parsed.speed, incline: parsed.incline });
    }

    let msg = null;
    try {
      msg = this._rx.push(bytes);
    } catch (err) {
      this.onLog('warn', `Malformed response: ${err.message}`);
    }
    if (!msg) return;
    this._responseWaiter?.();
    this._handleResponse(msg);
  }

  /** Reassembles the request being sent so its response can be decoded later. */
  _trackRequest(data) {
    let msg = null;
    try {
      msg = this._tx.push(data);
    } catch {
      return;
    }
    const req = msg && parseRequest(msg);
    if (!req) return;
    this._pending.push(req);
    if (this._pending.length > 4) this._pending.shift();
  }

  _handleResponse(msg) {
    // The response belongs to the oldest pending request with the same command
    const i = this._pending.findIndex((r) => r.command === msg[6]);
    const req = i >= 0 ? this._pending[i] : null;
    if (i >= 0) this._pending.splice(0, i + 1);

    const res = parseResponse(msg, req);
    if (!res) {
      this.onLog('warn', `Unknown response: ${toHex(msg)}`);
      return;
    }
    if (!res.checksumOk || !res.lengthOk) {
      this.onLog('warn', `Response ${res.name} with wrong ${!res.checksumOk ? 'checksum' : 'length'}: ${toHex(msg)}`);
    }
    if (!res.ok) {
      const what = req?.writeValues && Object.keys(req.writeValues).length
        ? ` when writing ${JSON.stringify(req.writeValues)}` : '';
      this.onLog('warn', `The treadmill answered ${res.name} with status ${res.status} (not OK)${what}`);
      return;
    }

    if (res.command === 0x02) {
      if (req?.writeValues && Object.keys(req.writeValues).length) {
        this.onLog('info', `Accepted: ${JSON.stringify(req.writeValues)}`);
      }
      const v = res.values || {};
      if ('MinKph' in v || 'MaxKph' in v || 'MinIncline' in v || 'MaxIncline' in v) {
        this.limits = { minKph: v.MinKph, maxKph: v.MaxKph, minIncline: v.MinIncline, maxIncline: v.MaxIncline };
        Object.assign(this.info, { limits: this.limits });
        this.onLog('info', `Limits: speed ${v.MinKph}–${v.MaxKph} km/h, incline ${v.MinIncline}–${v.MaxIncline} %`);
        this.onInfo({ ...this.info });
        return;
      }
      if (res.values && Object.keys(res.values).length) {
        this.onLog('rx', `= ${JSON.stringify(res.values)}${res.complete ? '' : ` (incomplete, ${res.leftover} bytes left over)`}`);
        this._logDataChanges(res.values);
        const status = toStatus(res.values);
        if ('speed' in status) this._fullDecode = true;
        this._publish(status);
      }
      return;
    }

    const info = {};
    if (res.supported) info.supported = res.supported;
    if (res.list) info[res.command === 0x80 ? 'capabilities' : 'commands'] = res.list;
    if (res.reference != null) info.reference = res.reference;
    if (res.firmware) info.firmware = res.firmware;
    if (res.serial) info.serial = res.serial;
    if (Object.keys(info).length) {
      Object.assign(this.info, info);
      this.onLog('info', `${res.name}: ${JSON.stringify(info)}`);
      this.onInfo({ ...this.info });
    }
  }

  /** Logs the key values whenever they change (without enabling TX/RX). */
  _logDataChanges(v) {
    const pick = ['Kph', 'CurrentKph', 'Incline', 'CurrentIncline', 'Mode'];
    const fresh = Object.fromEntries(pick.filter((k) => k in v).map((k) => [k, v[k]]));
    if (v.Pulse) fresh.HR = v.Pulse.bpm;
    if (!Object.keys(fresh).length) return; // response without key data (the cycle's other message)
    this._shown = { ...this._shown, ...fresh };
    const sig = JSON.stringify(this._shown);
    if (sig === this._lastDataSig) return;
    this._lastDataSig = sig;
    this.onLog('data', sig);
  }

  _publish(status) {
    if (status.mode != null && status.mode !== this.state.mode) {
      this.onLog('info', `Treadmill mode: ${MODES[status.mode] || status.mode}`);
    }
    Object.assign(this.state, status, { updatedAt: Date.now() });
    this.onData({ ...this.state });
  }

  _onDisconnected() {
    const was = this.running || this.writeChar;
    this.running = false;
    this.writeChar = null;
    this.notifyChar = null;
    this._responseWaiter?.();
    if (was) this.onStatus('disconnected');
  }
}

/**
 * Simulator: same interface, no Bluetooth. The belt accelerates ~1.5 km/h per
 * second and incline changes 0.5 % per second, like a real treadmill.
 * Starts stopped: use toggleBelt() to mimic the console buttons.
 */
export class SimulatedTreadmill {
  constructor({ onStatus = noop, onData = noop, onInfo = noop, onLog = noop } = {}) {
    Object.assign(this, { onStatus, onData, onInfo, onLog });
    this.state = { speed: 0, incline: 0, targetSpeed: 0, mode: 1, distance: 0, time: 0, calories: 0, pulse: null, updatedAt: 0 };
    this.target = { speed: 0, incline: 0 };
    this.belt = false;
    this.running = false;
    this.simulated = true;
  }

  get connected() {
    return this.running;
  }

  async connect() {
    this.onStatus('connecting');
    await sleep(300);
    this.onStatus('initializing');
    await sleep(500);
    this.running = true;
    this.info = { firmware: 'simulator', serial: 'SIM-0001', reference: 0, supported: [0, 1, 4, 9, 10, 12, 16, 20, 21] };
    this.onInfo({ ...this.info });
    this.onLog('info', 'Simulator ready. Use "Console Start/Stop" to move the belt.');
    this.onStatus('ready', 'Simulator');
    this._stopTimer = every(POLL_INTERVAL_MS, () => this._tick(0.2));
  }

  disconnect() {
    this._stopTimer?.();
    this.running = false;
    this.onStatus('disconnected');
  }

  pause() {
    this.belt = false;
    this.target.speed = 0;
    this.onLog('info', 'Pause mode (sim)');
  }

  pauseNow() {
    this.pause();
  }

  /** Same as pressing START/STOP on the console. */
  toggleBelt() {
    this.belt = !this.belt;
    if (this.belt && this.target.speed < LIMITS.speedMin) this.target.speed = 3.2;
    if (!this.belt) this.target.speed = 0;
    this.onLog('info', this.belt ? 'Console: START' : 'Console: STOP');
  }

  setSpeed(kmh) {
    if (!this.belt) return this.onLog('warn', `Ignored (belt stopped): speed ${kmh}`);
    this.target.speed = Math.min(LIMITS.speedMax, Math.max(0, Math.round(kmh * 10) / 10));
    if (this.target.speed === 0) this.belt = false;
    this.onLog('tx', `speed ${this.target.speed} km/h (sim)`);
  }

  setIncline(pct) {
    this.target.incline = Math.min(LIMITS.inclineMax, Math.max(0, Math.round(pct * 2) / 2));
    this.onLog('tx', `incline ${this.target.incline}% (sim)`);
  }

  _tick(dt) {
    const approach = (cur, tgt, rate) =>
      Math.abs(tgt - cur) <= rate * dt ? tgt : cur + Math.sign(tgt - cur) * rate * dt;
    const s = this.state;
    s.speed = Math.round(approach(s.speed, this.target.speed, 1.5) * 100) / 100;
    s.incline = Math.round(approach(s.incline, this.target.incline, 0.5) * 100) / 100;
    s.updatedAt = Date.now();
    s.targetSpeed = this.target.speed;
    s.mode = this.belt ? 2 : s.time > 0 ? 3 : 1; // running / paused / idle
    if (this.belt) {
      s.distance += (s.speed / 3.6) * dt;
      s.time += dt;
      s.calories += s.speed * dt * 0.02;
    }
    // Simulated "hand grip" HR: follows effort with a ~20 s lag
    const effort = 70 + s.speed * 9 + s.incline * 3;
    this.hr = (this.hr ?? 70) + (effort - (this.hr ?? 70)) * (dt / 20);
    s.pulse = { bpm: Math.round(this.hr), avg: 0, count: 0, source: 1 };
    // Simulated RR intervals, like a chest strap's
    if (this.belt) {
      this.rrSim ??= new RrSimulator();
      s.rr = this.rrSim.next(this.hr, dt);
    } else {
      s.rr = [];
    }
    this.onData({ ...s, distance: Math.round(s.distance), time: Math.floor(s.time) });
  }
}

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
