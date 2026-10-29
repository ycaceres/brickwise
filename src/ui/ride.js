/**
 * Ride tab: the selected bike workout over power (W) and HR. Only to look at
 * for now: riding on a bike trainer is not supported yet.
 */

import { $ } from '../lib/dom.js';
import { formatDuration } from '../workouts/steps.js';
import { planTimeline } from './run.js';
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
  $('rideNote').textContent = `${ride.steps.length} steps · ~${formatDuration(sec)}. Riding on a bike trainer is not supported yet: for now this page only shows the workout.${missing}`;
}
