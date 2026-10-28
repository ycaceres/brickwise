import './components/icon.js';
import './components/user-card.js';
import './components/zone-table.js';
import { every } from './lib/timer.js';
import * as intervals from './services/intervals.js';
import { $ } from './lib/dom.js';
import { loadJson, loadText } from './lib/storage.js';
import { log } from './ui/debug.js';
import { tick } from './session/runner.js';
import { updateControls } from './ui/train.js';
import { loadWorkouts, initWorkouts } from './ui/workouts.js';
import { DEBUG, NAV_TABS, showTab } from './ui/tabs.js';
import { initConfig } from './ui/config.js';
import { athlete, setProfile, loadProfileFromIntervals, renderProfile, refreshAthlete, refreshWellness } from './ui/profile.js';

const TICK_MS = 250; // how often the session advances and the screen refreshes

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
$('nav-debug').classList.toggle('hidden', !DEBUG);
$('btnSim').classList.toggle('hidden', !DEBUG);
for (const t of NAV_TABS) $(`nav-${t}`).onclick = () => showTab(t);
$('btnGoTrain').onclick = () => showTab('train');
$('hGoProfile').onclick = () => showTab('profile');

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
{
  const saved = loadJson('profile');
  const tab = loadText('tab');
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
