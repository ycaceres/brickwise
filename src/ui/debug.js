/**
 * Debug tab (only with ?debug=true): the communication log and what the
 * treadmill console reports.
 */

import { $, download } from '../lib/dom.js';
import { formatDuration } from '../workouts/steps.js';
import { live, STALE_MS } from '../session/live.js';
import { updateControls } from './run.js';
import * as app from '../state.js';
import { events as sessionEvents } from '../session/runner.js';

export const logLines = [];
export function log(kind, text) {
  const line = `${new Date().toISOString().slice(11, 23)} ${kind.toUpperCase().padEnd(5)} ${text}`;
  logLines.push(line);
  if (logLines.length > 20000) logLines.splice(0, 5000);
  if ((kind === 'tx' || kind === 'rx') && !$('logTraffic').checked) return;
  const el = document.createElement('div');
  el.className = kind;
  el.textContent = line;
  const box = $('log');
  box.appendChild(el);
  while (box.childElementCount > 400) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

/** Startup: wires the Debug tab. */
export function initDebug() {
  sessionEvents.on('log', ({ kind, text }) => log(kind, text));
  $('btnLogDownload').onclick = () => download(`brickwise-log-${Date.now()}.txt`, logLines.join('\n'), 'text/plain');
}

// What the console reports
let lastMode;
export function renderConsole() {
  const c = live.console;
  const dev = app.state.devices.controllable;
  const fresh = dev && Date.now() - (dev.state.updatedAt || 0) < STALE_MS;
  // Driver-specific rows (iFit mode, console HR source…)
  const diag = Object.fromEntries(fresh ? dev.diagnostics?.() ?? [] : []);
  const modeEl = $('cMode');
  modeEl.textContent = diag.Mode ?? '—';
  modeEl.dataset.belt = fresh ? c.belt ?? '' : '';
  modeEl.dataset.alert = fresh && c.alerts?.length ? 'true' : '';
  const mode = fresh ? `${c.belt}|${c.alerts?.join(',')}` : undefined;
  if (mode !== lastMode) {
    lastMode = mode;
    updateControls(); // the safety key notice depends on the alerts
  }
  const set = (id, text) => { $(id).textContent = fresh && text != null ? text : '—'; };
  set('cSpeed', c.speed != null ? `${c.speed.toFixed(1)} km/h${c.speedSource === 'requested' ? ' (no actual reading)' : ''}` : null);
  set('cTarget', c.targetSpeed != null ? `${c.targetSpeed.toFixed(1)} km/h` : null);
  set('cIncline', c.incline != null ? `${c.incline.toFixed(1)} %` : null);
  set('cDist', c.distance != null ? `${(c.distance / 1000).toFixed(2)} km` : null);
  set('cTime', c.time != null ? formatDuration(c.time) : null);
  set('cCal', c.calories != null ? `${Math.round(c.calories)} kcal` : null);
  set('cPulse', diag['Console HR'] ?? null);
}

export function renderInfo() {
  const i = live.info;
  const parts = [];
  if (i.firmware) parts.push(`Firmware ${i.firmware}`);
  if (i.serial) parts.push(`Serial ${i.serial}`);
  if (i.reference) parts.push(`Model ${i.reference}`);
  if (i.supported) parts.push(`${i.supported.length} supported fields`);
  if (i.limits?.minKph != null) parts.push(`Speed ${i.limits.minKph}–${i.limits.maxKph} km/h`);
  if (i.limits?.maxIncline != null) parts.push(`Incline ${i.limits.minIncline}–${i.limits.maxIncline} %`);
  $('cInfo').textContent = parts.join(' · ') || 'No equipment info yet.';
}
