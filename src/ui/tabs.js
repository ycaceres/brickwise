/**
 * Tabs: the ones with a button in the sidebar, plus pages without one that
 * are opened from the content (a workout, from Home or the library); the
 * sidebar leads back from them.
 */

import { $ } from '../lib/dom.js';
import { saveText } from '../lib/storage.js';
import { updateChart } from './train.js';
import { updatePreview } from './workouts.js';
import { session } from '../session/runner.js';

// The Debug tab (console state and log) and Simulation mode only show with ?debug=true
export const DEBUG = new URLSearchParams(location.search).get('debug') === 'true';
export const NAV_TABS = ['home', 'workouts', 'train', 'config', 'profile', ...(DEBUG ? ['debug'] : [])];
const PAGES = ['workout'];
const ALL = [...NAV_TABS, ...PAGES];

export function showTab(name) {
  if (!ALL.includes(name)) name = 'home';
  for (const t of ALL) $(`tab-${t}`).classList.toggle('hidden', t !== name);
  for (const t of NAV_TABS) $(`nav-${t}`).setAttribute('aria-selected', String(t === name));
  $('devicePills').classList.toggle('hidden', name !== 'train');
  saveText('tab', name);
  // The charts measure their width when shown
  if (name === 'train') updateChart();
  // Before a session, the safety reminder (not over a running one)
  const idle = !['armed', 'running', 'paused'].includes(session.state);
  const pop = $('safetyPop');
  if ((name === 'train' && idle) !== pop.matches(':popover-open')) pop.togglePopover();
  if (name === 'workout') updatePreview();
}

/** Startup: the sidebar, the links between tabs and the safety reminder. */
export function initTabs() {
  $('nav-debug').classList.toggle('hidden', !DEBUG);
  $('btnSim').classList.toggle('hidden', !DEBUG);
  for (const t of NAV_TABS) $(`nav-${t}`).onclick = () => showTab(t);
  $('btnGoTrain').onclick = () => showTab('train');
  $('hGoProfile').onclick = () => showTab('profile');
  $('safetyOk').onclick = () => $('safetyPop').hidePopover();
}
