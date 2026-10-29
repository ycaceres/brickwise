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
import { t } from '../i18n/index.js';

export function updateRide() {
  const ride = app.state.selection?.event?.sport === 'ride' ? app.state.selection : null;
  const chart = $('rideChart');
  chart.classList.toggle('hidden', !ride);
  if (!ride) {
    $('rideNote').textContent = t('ride.pick');
    return;
  }
  chart.heading = ride.event.name || t('nav.ride');
  chart.update({ plan: planTimeline(true), samples: [], elapsed: 0, zones: app.zonesFor(ride.event) });
  const sec = ride.steps.reduce((a, s) => a + (s.duration || 0), 0);
  const missing = ride.needsProfile ? ` ${t('ride.noFtp')}` : '';
  $('rideNote').textContent = `${t('common.steps', { n: ride.steps.length })} · ~${formatDuration(sec)}. ${t('ride.later')}${missing}`;
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
  document.addEventListener('bw-language', () => { updateRide(); updateTrainerCard(); });
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
