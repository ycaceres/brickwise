import { every } from './lib/timer.js';
import * as intervals from './services/intervals.js';
import { $ } from './lib/dom.js';
import { loadJson, loadText, saveText } from './lib/storage.js';
import { log } from './ui/debug.js';
import { tick } from './session/runner.js';
import { updateChart, updateControls } from './ui/train.js';
import { loadWorkouts, updatePreview, initWorkouts } from './ui/workouts.js';
import { athlete, setProfile, loadProfileFromIntervals, renderProfile, refreshAthlete } from './ui/profile.js';

const TICK_MS = 250; // how often the session advances and the screen refreshes

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
// The Debug tab (console state and log) only shows with ?debug=true
const DEBUG = new URLSearchParams(location.search).get('debug') === 'true';
const TABS = DEBUG ? ['profile', 'workouts', 'train', 'debug'] : ['profile', 'workouts', 'train'];
$('nav-debug').classList.toggle('hidden', !DEBUG);
function showTab(name) {
  if (!TABS.includes(name)) name = 'train';
  for (const t of TABS) {
    $(`tab-${t}`).classList.toggle('hidden', t !== name);
    $(`nav-${t}`).setAttribute('aria-selected', String(t === name));
  }
  saveText('tab', name);
  // The chart measures its width when shown
  if (name === 'train') updateChart();
  if (name === 'workouts') updatePreview();
}
for (const t of TABS) $(`nav-${t}`).onclick = () => showTab(t);
$('btnGoTrain').onclick = () => showTab('train');
$('pillIntervals').onclick = () => showTab('profile');

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
{
  const saved = loadJson('profile');
  const tab = loadText('tab');
  initWorkouts();
  if (saved?.pacePct) setProfile(saved, { save: false });
  else if (intervals.getApiKey()) loadProfileFromIntervals();
  renderProfile();
  if (intervals.getApiKey() && !athlete) refreshAthlete().catch((err) => log('warn', `Intervals.icu: ${err.message}`));
  showTab(tab || 'train');
  every(TICK_MS, tick);
  updateControls();
  loadWorkouts();
  try { sessionStorage.removeItem('brickwise.loadRetry'); } catch { /* optional */ }
}
