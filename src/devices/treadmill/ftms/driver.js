/**
 * Any treadmill that speaks Bluetooth FTMS (Fitness Machine Service): reads
 * Treadmill Data, sends target speed and incline through the Control Point,
 * follows the Machine Status. Built on the shared helpers (ble/) and the
 * Treadmill base class. Not yet tested on hardware (see #26).
 */
import { Treadmill } from '../treadmill.js';
import { connectGatt, subscribe } from '../../ble/gatt.js';
import { createWriteQueue } from '../../ble/write-queue.js';
import {
  SERVICE, FEATURE, TREADMILL_DATA, SPEED_RANGE, INCLINE_RANGE, CONTROL_POINT, MACHINE_STATUS,
  parseTreadmillData, parseFeatures, parseSpeedRange, parseInclineRange, parseControlResponse, parseMachineStatus,
  requestControl, setTargetSpeed, setTargetIncline, stopOrPause,
} from './protocol.js';

export class FtmsTreadmill extends Treadmill {
  constructor(events = {}, descriptor = {}) {
    super(events, descriptor);
    this.state = { speed: 0, incline: 0, belt: 'stopped', alerts: [], updatedAt: 0 };
    this.running = false;
    this.features = null;
    this.lastResult = null;
    this._write = null;
    this._stops = [];
  }

  get connected() {
    return this.running && !!this.device?.gatt?.connected;
  }

  /** opts.device: a Bluetooth device the app already chose. */
  async connect(opts = {}) {
    this.onStatus('connecting');
    this.device = opts.device ?? await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }] });
    const server = await connectGatt(this.device, { onDisconnect: () => this._onDisconnected() });
    this.onStatus('initializing');
    const service = await server.getPrimaryService(SERVICE);
    const read = async (uuid) => { try { return await (await service.getCharacteristic(uuid)).readValue(); } catch { return null; } };

    const feat = await read(FEATURE);
    if (feat) {
      this.features = parseFeatures(feat);
      this.capabilities.incline = this.features.inclineTarget;
    }
    const sr = await read(SPEED_RANGE);
    if (sr) { const r = parseSpeedRange(sr); Object.assign(this.limits, { speedMin: r.min, speedMax: r.max, speedStep: r.step || this.limits.speedStep }); }
    const ir = await read(INCLINE_RANGE);
    if (ir) { const r = parseInclineRange(ir); Object.assign(this.limits, { inclineMin: r.min, inclineMax: r.max, inclineStep: r.step || this.limits.inclineStep }); }

    this._stops.push(await subscribe(await service.getCharacteristic(TREADMILL_DATA), (v) => this._onData(parseTreadmillData(v))));
    try {
      this._stops.push(await subscribe(await service.getCharacteristic(MACHINE_STATUS), (v) => this._onStatus(parseMachineStatus(v))));
    } catch { /* optional characteristic */ }

    const cp = await service.getCharacteristic(CONTROL_POINT);
    this._pending = null;
    this._stops.push(await subscribe(cp, (v) => {
      const res = parseControlResponse(v);
      if (!res) return;
      this.lastResult = res;
      this._pending?.(res);
    }));
    const raw = (data) => cp.writeValueWithResponse(data);
    this._write = createWriteQueue(raw, { retries: 2 });
    const res = await this._command(requestControl());
    if (!res?.ok) throw new Error(`the treadmill refused control (${res?.text ?? 'no answer'})`);
    this.running = true;
    this.info = { name: this.device.name, features: this.features };
    this.onInfo({ ...this.info });
    this.onStatus('ready', this.device.name || 'FTMS');
  }

  disconnect() {
    this.running = false;
    for (const stop of this._stops.splice(0)) stop().catch?.(() => {});
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.onStatus('disconnected');
  }

  setSpeed(kmh) { this._send(setTargetSpeed(kmh)); }
  setIncline(pct) { this._send(setTargetIncline(pct)); }
  pause() { this._send(stopOrPause(true)); }
  pauseNow() { if (this._write) this._write(stopOrPause(true)).catch(() => {}); }

  diagnostics() {
    return [
      ['FTMS targets', this.features ? `${this.features.speedTarget ? 'speed' : ''}${this.features.inclineTarget ? ' + incline' : ''}` : '—'],
      ['Last command', this.lastResult ? this.lastResult.text : '—'],
    ];
  }

  // --- internals --------------------------------------------------------------

  /** Writes a command and waits for its Control Point answer (up to 3 s). */
  async _command(data) {
    const answer = new Promise((resolve) => {
      this._pending = resolve;
      setTimeout(() => resolve(null), 3000);
    });
    await this._write(data);
    return answer;
  }

  _send(data) {
    if (!this._write) return; // not connected: nothing to send
    this._command(data).then((res) => {
      if (res && !res.ok) this.onLog('warn', `FTMS command 0x${data[0].toString(16)}: ${res.text}`);
    }).catch((err) => this.onLog('error', `FTMS: ${err.message}`));
  }

  _onData(d) {
    const s = this.state;
    Object.assign(s, d);
    if (d.speed != null && s.belt !== 'paused') s.belt = d.speed > 0 ? 'running' : 'stopped';
    if (d.hr != null) { s.hr = d.hr > 0 ? d.hr : null; s.hrSource = d.hr > 0 ? 'console' : null; }
    s.updatedAt = Date.now();
    this.onData({ ...s });
  }

  _onStatus(st) {
    if (st.belt) this.state.belt = st.belt;
    if (st.targetSpeed != null) this.state.targetSpeed = st.targetSpeed;
    if (st.event === 'control-lost') { this.onLog('warn', 'FTMS: another app took control of the treadmill'); this.onControlLost?.(); }
    else this.onLog('info', `FTMS: ${st.event}`);
  }

  _onDisconnected() {
    const was = this.running;
    this.running = false;
    this._write = null;
    if (was) this.onStatus('disconnected');
  }
}
