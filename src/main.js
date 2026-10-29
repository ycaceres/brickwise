import './components/icon.js';
import './components/user-card.js';
import './components/zone-table.js';
import './components/workout-list.js';
import './components/chart.js';
import { every } from './lib/timer.js';
import { loadPages } from './lib/pages.js';
import * as intervals from './services/intervals.js';
import { loadJson, loadText } from './lib/storage.js';
import { initDebug, log } from './ui/debug.js';
import { initDevices } from './ui/devices.js';
import { tick } from './session/runner.js';
import { initRun, updateControls } from './ui/run.js';
import { loadWorkouts, initWorkouts } from './ui/workouts.js';
import { initTabs, showTab } from './ui/tabs.js';
import { initConfig } from './ui/config.js';
import { initProfile, athlete, setProfile, loadProfileFromIntervals, renderProfile, refreshAthlete, refreshWellness } from './ui/profile.js';

const TICK_MS = 250; // how often the session advances and the screen refreshes

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
// Without the pages there is no app: the same notice as a module that fails to load
try {
  await loadPages();
} catch (err) {
  window.appLoadFailed?.();
  throw err;
}

{
  const saved = loadJson('profile');
  const tab = loadText('tab');
  // Wiring first, then the data
  initTabs();
  initDebug();
  initDevices();
  initRun();
  initProfile();
  initConfig();
  initWorkouts();
  if (saved?.pacePct) setProfile(saved, { save: false });
  // Without a stored profile, or one from before the cycling zones: ask Intervals.icu
  if (intervals.getApiKey() && (!saved?.pacePct || (saved.source === 'intervals' && !('ride' in saved)))) loadProfileFromIntervals();
  renderProfile();
  if (intervals.getApiKey() && !athlete) refreshAthlete().catch((err) => log('warn', `Intervals.icu: ${err.message}`));
  if (intervals.getApiKey()) refreshWellness().catch((err) => log('warn', `Intervals.icu wellness: ${err.message}`));
  showTab(tab || 'home');
  every(TICK_MS, tick);
  updateControls();
  loadWorkouts();
  try { sessionStorage.removeItem('brickwise.loadRetry'); } catch { /* optional */ }
}
