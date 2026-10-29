/**
 * Ride tab: the selected bike workout over power (W) and HR, and the
 * connected smart trainer with manual targets. Riding a workout on the
 * trainer (a ride session) comes later.
 */

import { $ } from '../lib/dom.js';
import { formatDuration } from '../workouts/steps.js';
import { planTimeline } from './run.js';
import { live } from '../session/live.js';
import * as app from '../state.js';

export function updateRide() {
  const ride = app.state.selection?.event?.sport === 'ride' ? app.state.selection : null;
  const chart = $('rideChart');
  chart.classList.toggle('hidden', !ride);
  if (!ride) {
    $('rideNote').textContent = 'Pick a bike workout in Home to see it here.';
    return;
  }
  chart.heading = ride.event.name || 'Ride';
  chart.update({ plan: planTimeline(true), samples: [], elapsed: 0, zones: app.zonesFor(ride.event) });
  const sec = ride.steps.reduce((a, s) => a + (s.duration || 0), 0);
  const missing = ride.needsProfile ? ' FTP is missing in Intervals.icu: without it, the chart only shows the workout shape.' : '';
  $('rideNote').textContent = `${ride.steps.length} steps · ~${formatDuration(sec)}. Riding it on the trainer comes later: for now this page shows the workout, and a connected trainer can be controlled by hand.${missing}`;
}

/**
 * The connected smart trainer: power, cadence and speed, and manual ERG or
 * resistance targets, each shown only if the trainer can do it.
 */
export function updateTrainerCard() {
  const dev = app.state.devices.trainer;
  const on = !!dev?.connected;
  $('rideTrainer').classList.toggle('hidden', !on);
  if (!on) return;
  const s = live.trainer || {};
  $('rtPower').textContent = s.power != null ? Math.round(s.power) : '--';
  $('rtCadence').textContent = s.cadence != null ? Math.round(s.cadence) : '--';
  $('rtSpeed').textContent = s.speed != null ? s.speed.toFixed(1) : '--';
  $('rtErg').classList.toggle('hidden', !dev.capabilities.erg);
  $('rtResistance').classList.toggle('hidden', !dev.capabilities.resistance);
  $('rtTarget').textContent = dev.mode === 'erg' && dev.requested.power != null ? dev.requested.power : '--';
  $('rtLevel').textContent = dev.mode === 'resistance' && dev.requested.resistance != null ? dev.requested.resistance : '--';
}

/** Startup: redraw on each selection; the trainer's manual targets. */
export function initRide() {
  app.on('selection', updateRide);
  $('tab-ride').querySelectorAll('[data-power]').forEach((btn) => {
    btn.onclick = () => {
      const dev = app.state.devices.trainer;
      if (!dev?.connected) return;
      const base = dev.mode === 'erg' && dev.requested.power != null ? dev.requested.power : Math.round(live.trainer?.power ?? 100);
      dev.setTarget({ power: base + parseFloat(btn.dataset.power) });
      updateTrainerCard();
    };
  });
  $('tab-ride').querySelectorAll('[data-resistance]').forEach((btn) => {
    btn.onclick = () => {
      const dev = app.state.devices.trainer;
      if (!dev?.connected) return;
      const base = dev.mode === 'resistance' && dev.requested.resistance != null ? dev.requested.resistance : 20;
      dev.setResistance(base + parseFloat(btn.dataset.resistance));
      updateTrainerCard();
    };
  });
}
