/**
 * Header pills for the devices: the treadmill (or its simulator), with its
 * menu, and the heart rate strap. Their readings go to session/live.js.
 */

import { $, setPill } from '../lib/dom.js';
import { getDriver } from '../devices/registry.js';
import { live, addRr } from '../session/live.js';
import { log, renderInfo } from './debug.js';
import { updateControls } from './run.js';
import * as app from '../state.js';


function treadmillCallbacks() {
  return {
    onStatus: (state, detail) => {
      const map = {
        connecting: ['busy', 'Controllable: connecting…'],
        initializing: ['busy', 'Controllable: activating…'],
        ready: ['ready', `Controllable: ${detail || 'ready'}`],
        disconnected: ['error', 'Controllable: disconnected'],
      };
      const [s, t] = map[state] || ['error', `Controllable: ${state}`];
      setPill('pillTreadmill', s, t);
      log(state === 'disconnected' ? 'warn' : 'info', t);
      if (state === 'disconnected') {
        live.speed = 0;
        live.console = {};
        if (live.hrSource === 'console') { live.hr = null; live.hrSource = null; }
      }
      const ready = state === 'ready';
      $('btnConnect').disabled = $('btnSim').disabled = ready || state === 'connecting' || state === 'initializing';
      $('btnDisconnect').disabled = !ready;
      $('btnSimBelt').classList.toggle('hidden', !(ready && app.state.devices.controllable?.simulated));
      updateControls();
    },
    onData: (state) => {
      live.speed = state.speed ?? 0;
      live.incline = state.incline ?? 0;
      live.console = state;
      // HR from the console (hand grips or a strap paired with the treadmill),
      // only if no strap is connected to the page
      if (hrStrap.bpm == null) {
        if (state.rr?.length) addRr(state.rr, null); // only the simulator sends RR this way
        const bpm = state.pulse?.bpm;
        live.hr = bpm > 0 ? bpm : null;
        live.hrSource = bpm > 0 ? 'console' : null;
      }
    },
    onInfo: (info) => {
      live.info = info;
      renderInfo();
    },
    onLog: log,
  };
}

async function connectTreadmill(simulated) {
  const treadmill = getDriver(simulated ? 'simulated-treadmill' : 'nordictrack-exp5i').create(treadmillCallbacks());
  app.setDevice('controllable', treadmill);
  try {
    await treadmill.connect();
  } catch (err) {
    log('error', err.message);
    setPill('pillTreadmill', 'error', 'Controllable: error');
    $('btnConnect').disabled = $('btnSim').disabled = false;
  }
}

const hrStrap = getDriver('hr-strap').create({
  onHr: (bpm) => { live.hr = bpm; live.hrSource = 'strap'; },
  onRr: addRr,
  onStatus: (state, name) => {
    if (state === 'ready') setPill('pillHr', 'ready', `HRM: ${name || 'connected'}`);
    else { live.hr = null; live.hrSource = null; setPill('pillHr', 'error', 'HRM: disconnected'); }
  },
});

/** Startup: the controllable menu and the HRM pill. */
export function initDevices() {
  app.setDevice('hr', hrStrap);
  // Treadmill menu: opens under its pill and closes on choice
  const menu = $('menuTreadmill');
  menu.addEventListener('toggle', (e) => {
    if (e.newState !== 'open') return;
    const r = $('pillTreadmill').getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  });
  const fromMenu = (fn) => () => { menu.hidePopover(); fn(); };
  $('btnConnect').onclick = fromMenu(() => connectTreadmill(false));
  $('btnSim').onclick = fromMenu(() => connectTreadmill(true));
  $('btnDisconnect').onclick = fromMenu(() => app.state.devices.controllable?.disconnect());
  $('btnSimBelt').onclick = fromMenu(() => app.state.devices.controllable?.toggleBelt?.());
  $('pillHr').onclick = async () => {
    if ($('pillHr').dataset.state === 'ready' || $('pillHr').dataset.state === 'busy') return;
    try {
      setPill('pillHr', 'busy', 'HRM: connecting…');
      await hrStrap.connect();
    } catch (err) {
      log('error', `HRM: ${err.message}`);
      setPill('pillHr', 'error', 'HRM: error');
    }
  };
}
