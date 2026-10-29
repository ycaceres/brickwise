/**
 * Tabs: the ones with a button in the sidebar, plus pages without one that
 * are opened from the content (a workout, from Home or the library); the
 * sidebar leads back from them.
 */

import { $ } from '../lib/dom.js';
import * as settings from '../lib/settings.js';
import { updateChart } from './run.js';
import { updatePreview, selected } from './workouts.js';
import { updateRide } from './ride.js';
import { session } from '../session/runner.js';

// The Debug tab (console state and log) and Simulation mode only show with ?debug=true
export const DEBUG = new URLSearchParams(location.search).get('debug') === 'true';
export const NAV_TABS = ['home', 'workouts', 'run', 'ride', 'config', 'profile', ...(DEBUG ? ['debug'] : [])];
const PAGES = ['workout'];
const ALL = [...NAV_TABS, ...PAGES];

// Tabs renamed since: a saved old name opens the new tab
const RENAMED = { train: 'run' };

export function showTab(name) {
  name = RENAMED[name] ?? name;
  if (!ALL.includes(name)) name = 'home';
  for (const t of ALL) $(`tab-${t}`).classList.toggle('hidden', t !== name);
  for (const t of NAV_TABS) $(`nav-${t}`).setAttribute('aria-selected', String(t === name));
  $('devicePills').classList.toggle('hidden', name !== 'run');
  settings.set('tab', name);
  // The charts measure their width when shown
  if (name === 'run') updateChart();
  if (name === 'ride') updateRide();
  // Before a session, the safety reminder (not over a running one)
  const idle = !['armed', 'running', 'paused'].includes(session.state);
  const pop = $('safetyPop');
  if ((name === 'run' && idle) !== pop.matches(':popover-open')) pop.togglePopover();
  if (name === 'workout') updatePreview();
}

/** Where a workout runs: Ride for bike workouts, Run for the rest (treadmill). */
const sessionTab = (event) => (event?.sport === 'ride' ? 'ride' : 'run');

/** Startup: the sidebar, the links between tabs and the safety reminder. */
export function initTabs() {
  $('nav-debug').classList.toggle('hidden', !DEBUG);
  $('btnSim').classList.toggle('hidden', !DEBUG);
  for (const t of NAV_TABS) $(`nav-${t}`).onclick = () => showTab(t);
  $('btnGoWorkout').onclick = () => showTab(sessionTab(selected?.event));
  $('hGoProfile').onclick = () => showTab('profile');
  $('safetyOk').onclick = () => $('safetyPop').hidePopover();
}
