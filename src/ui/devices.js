/**
 * Header pills for the devices: a treadmill (Run tab) and a smart trainer
 * (Ride tab), each with a menu built from the driver registry
 * (device-menu.js), and the heart rate strap. Their readings go to
 * session/live.js. No model is named here: drivers come from the registry.
 */

import { $, setPill } from '../lib/dom.js';
import * as settings from '../lib/settings.js';
import { getDriver, requestOptions, detect } from '../devices/registry.js';
import { live, addRr } from '../session/live.js';
import { log, renderInfo } from './debug.js';
import { updateControls } from './run.js';
import { updateTrainerCard } from './ride.js';
import { DEBUG } from './tabs.js';
import { connectPlan, menuEntries, KIND_NAMES } from './device-menu.js';
import * as app from '../state.js';

const PILLS = { treadmill: 'pillTreadmill', trainer: 'pillTrainer' };
const MENUS = { treadmill: 'menuTreadmill', trainer: 'menuTrainer' };
const LABELS = { treadmill: 'Treadmill', trainer: 'Trainer' };

// HR from the console or the trainer, only while no strap is connected to the page
function deviceHr(state, source) {
  if (hrStrap.bpm != null) return;
  if (state.rr?.length) addRr(state.rr, null); // only the simulators send RR this way
  live.hr = state.hr ?? null;
  live.hrSource = state.hr ? source : null;
}

function callbacks(kind) {
  const label = LABELS[kind];
  return {
    onStatus: (status, detail) => {
      const map = {
        connecting: ['busy', `${label}: connecting…`],
        initializing: ['busy', `${label}: activating…`],
        ready: ['ready', `${label}: ${detail || 'ready'}`],
        disconnected: ['error', `${label}: disconnected`],
      };
      const [s, t] = map[status] || ['error', `${label}: ${status}`];
      setPill(PILLS[kind], s, t);
      log(status === 'disconnected' ? 'warn' : 'info', t);
      const dev = app.state.devices[kind];
      if (status === 'ready' && !dev?.descriptor?.debugOnly) {
        // Remembered for the menu ("last: …"); simulators are not
        const last = settings.get('lastDevice');
        settings.set('lastDevice', { ...last, [kind]: { driver: dev?.descriptor?.id, name: detail || dev?.descriptor?.name } });
      }
      if (status === 'disconnected') {
        if (kind === 'treadmill') { live.speed = 0; live.console = {}; }
        else live.trainer = null;
        if (live.hrSource === (kind === 'treadmill' ? 'console' : 'trainer')) { live.hr = null; live.hrSource = null; }
      }
      updateControls();
      updateTrainerCard();
    },
    onData: kind === 'treadmill'
      ? (state) => {
        live.speed = state.speed ?? 0;
        live.incline = state.incline ?? 0;
        live.console = state;
        deviceHr(state, 'console');
      }
      : (state) => {
        live.trainer = state;
        deviceHr(state, 'trainer');
        updateTrainerCard();
      },
    onInfo: (info) => {
      live.info = info;
      renderInfo();
    },
    onLog: log,
    onControlLost: () => log('warn', `${label}: another app took control`),
  };
}

/** Connects a device of a kind: a simulator by id, or the real one(s) from the registry. */
async function connect(kind, driverId = null) {
  setPill(PILLS[kind], 'busy', `${LABELS[kind]}: connecting…`);
  try {
    let driver = driverId ? getDriver(driverId) : null;
    let device;
    if (!driver) {
      const plan = connectPlan(kind);
      if (plan.mode === 'single') driver = plan.driver;
      else if (plan.mode === 'chooser') {
        // One Bluetooth chooser for every driver of the kind, then the one that fits
        device = await navigator.bluetooth.requestDevice(requestOptions(kind));
        driver = detect(kind, device);
        if (!driver) throw new Error(`${device.name || 'This device'} is not a supported ${KIND_NAMES[kind]}`);
      } else throw new Error(`No ${KIND_NAMES[kind]} support yet`);
    }
    const dev = driver.create(callbacks(kind));
    app.setDevice(kind, dev);
    await dev.connect(device ? { device } : undefined);
  } catch (err) {
    log('error', err.message);
    setPill(PILLS[kind], 'error', `${LABELS[kind]}: error`);
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

/** Draws a kind's menu from the registry and the connected device. */
function renderMenu(kind) {
  const menu = $(MENUS[kind]);
  const device = app.state.devices[kind];
  const entries = menuEntries(kind, { debug: DEBUG, device, last: settings.get('lastDevice')[kind] });
  menu.replaceChildren(...entries.map((e) => {
    const b = document.createElement('button');
    b.textContent = e.label;
    b.disabled = !!e.disabled;
    if (e.primary) b.className = 'primary';
    if (e.danger) b.className = 'danger';
    b.dataset.action = e.action;
    b.onclick = () => {
      menu.hidePopover();
      if (e.action === 'connect') connect(kind);
      else if (e.action === 'simulator') connect(kind, e.driver);
      else if (e.action === 'sim-belt') device?.simulate({ belt: 'toggle' });
      else if (e.action === 'sim-pedal') device?.simulate({ pedaling: !device.pedaling });
      else if (e.action === 'disconnect') device?.disconnect();
    };
    return b;
  }));
}

/** Startup: the device menus and the HRM pill. */
export function initDevices() {
  app.setDevice('hr', hrStrap);
  for (const kind of Object.keys(MENUS)) {
    const menu = $(MENUS[kind]);
    // Opens under its pill, freshly drawn
    menu.addEventListener('toggle', (e) => {
      if (e.newState !== 'open') return;
      renderMenu(kind);
      const r = $(PILLS[kind]).getBoundingClientRect();
      menu.style.top = `${r.bottom + 6}px`;
      menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    });
  }
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
