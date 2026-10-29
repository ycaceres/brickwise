/**
 * Workouts: the runs and rides planned in Intervals.icu for a day (Home), the
 * training library with its filters, and the workout page (steps, totals and
 * chart) that a click on any of them opens.
 */

import { $, escapeHtml } from '../lib/dom.js';
import * as settings from '../lib/settings.js';
import * as app from '../state.js';
import { flattenWorkout, followsHr, formatPace, formatDuration } from '../workouts/steps.js';
import { loadLibrary } from '../workouts/library.js';
import { resolveDoc } from '../physiology/zones.js';
import * as intervals from '../services/intervals.js';
import { log } from './debug.js';
import { session } from '../session/runner.js';
import { render, updateChart, updateControls, planTimeline } from './run.js';
import { showTab } from './tabs.js';
import { updateRide } from './ride.js';

let workouts = null;       // planned in Intervals.icu (null = not loaded)
let plannedError = null;   // why they could not be loaded, shown in the lists

export let selectedKey = 'none';  // 'none' | 'i:<index>' | 'l:<id>'

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export async function loadWorkouts() {
  const day = $('hDate').value || today();
  $('hPlanned').entries = [{ note: 'Loading…' }];
  if (!intervals.getApiKey()) {
    workouts = [];
    renderLists();
    selectWorkout(selectedKey.startsWith('i:') ? 'none' : selectedKey);
    return;
  }
  plannedError = null;
  try {
    workouts = await intervals.getWorkouts(day, day);
    log('info', `Intervals.icu: ${workouts.length} workout(s) on ${day}`);
  } catch (err) {
    workouts = [];
    plannedError = err.message;
    log('error', `Intervals.icu: ${err.message}`);
  }
  if (selectedKey.startsWith('i:')) selectedKey = 'none';
  if (selectedKey === 'none' && workouts.length) selectedKey = 'i:0';
  renderLists();
  selectWorkout(selectedKey);
}

/**
 * Whether HR can steer a workout: library workouts say so (hrControl), the
 * Intervals.icu ones are judged by their steps.
 */
function hrControllable(w) {
  if (w.hrControl != null) return w.hrControl;
  if (w.sport === 'ride') return false;
  return followsHr(flattenWorkout(resolveDoc(w.workout_doc, app.state.zones), { zones: app.state.zones }));
}

/** Approximate total duration of a workout_doc (s). */
function docSeconds(doc) {
  const walk = (steps) => steps.reduce((a, s) => a + (s.steps ? (s.reps || 1) * walk(s.steps) : s.duration || 0), 0);
  return walk(doc?.steps || []);
}

// Library (data/library.json): loaded at startup
let LIBRARY = [];
let libTypes = [];
let libDurations = [30, 45, 60];
let libError = null;
const libFilter = { minutes: 45, type: 'all', level: 'all', ...settings.get('libFilter') };

/** Nearest list duration (featured workouts may last 36 min, for example). */
const durationBucket = (min) => libDurations.reduce((a, b) => (Math.abs(b - min) < Math.abs(a - min) ? b : a), libDurations[0]);

function libraryMatches(w) {
  return (libFilter.minutes === 'all' || durationBucket(w.minutes) === libFilter.minutes) &&
    (libFilter.type === 'all' || w.type === libFilter.type) &&
    (libFilter.level === 'all' || w.level === libFilter.level);
}

/** Filters: duration, type and level, as dropdowns in one row. */
function renderFilters() {
  const box = $('wFilters');
  box.replaceChildren();
  const select = (label, key, options) => {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.textContent = label;
    const sel = document.createElement('select');
    for (const [value, text] of options) {
      const opt = document.createElement('option');
      opt.value = String(value);
      opt.textContent = text;
      opt.selected = libFilter[key] === value;
      sel.appendChild(opt);
    }
    sel.onchange = () => {
      const [value] = options.find(([v]) => String(v) === sel.value);
      libFilter[key] = value;
      settings.set('libFilter', libFilter);
      renderLists();
    };
    wrap.appendChild(sel);
    box.appendChild(wrap);
  };
  select('Duration', 'minutes', [['all', 'All'], ...libDurations.map((m) => [m, `${m} min`])]);
  select('Type', 'type', [['all', 'All'], ...libTypes.map((t) => [t.id, t.name])]);
  select('Level', 'level', [['all', 'All'], ...[1, 2, 3, 4, 5].map((n) => [n, String(n)])]);
}

/** Planned workouts of the day; Home filters them by sport. */
function plannedEntries(sport = 'all') {
  const shown = (workouts || []).map((w, i) => [w, i]).filter(([w]) => sport === 'all' || w.sport === sport);
  const entries = shown.map(([w, i]) => {
    const sec = docSeconds(w.workout_doc);
    return { key: `i:${i}`, title: w.name || 'Workout', sub: sec ? `~${formatDuration(sec)}` : '', hrControl: hrControllable(w), sport: w.sport };
  });
  if (!shown.length) {
    const none = { all: 'No runs or rides planned that day.', run: 'No runs planned that day.', ride: 'No rides planned that day.' }[sport];
    entries.push({ note: plannedError ? `Could not load from Intervals.icu: ${plannedError}` : workouts ? none : 'Loading…' });
  }
  return entries;
}

function renderLists() {
  $('hPlanned').entries = plannedEntries(homeSport);
  renderFilters();
  const entries = [{ key: 'none', title: 'No workout', sub: 'Manual speed and incline control' }];
  if (libError) entries.push({ note: `Could not load the library: ${libError}` });
  else if (!LIBRARY.length) entries.push({ note: 'Loading library…' });
  const shown = LIBRARY.filter(libraryMatches);
  for (const w of shown) {
    entries.push({ key: `l:${w.id}`, title: w.featured ? `★ ${w.name} · ${w.minutes} min` : w.name, sub: w.summary, hrControl: w.hrControl });
  }
  if (LIBRARY.length && !shown.length) entries.push({ note: 'No workouts match those filters.' });
  $('wLibrary').entries = entries;
  $('wLibCount').textContent = LIBRARY.length ? `${shown.length} of ${LIBRARY.length}` : '';
  markSelected();
}

function markSelected() {
  for (const list of document.querySelectorAll('bw-workout-list')) list.selected = selectedKey;
}

export function selectWorkout(key = selectedKey) {
  if (['armed', 'running', 'paused'].includes(session.state)) return;
  // The library is not loaded yet: keep the choice and apply it on load
  if (key.startsWith('l:') && !LIBRARY.length && !libError) { selectedKey = key; return; }
  let event = null;
  if (key.startsWith('i:')) event = workouts?.[Number(key.slice(2))] || null;
  if (key.startsWith('l:')) {
    const w = LIBRARY.find((x) => x.id === key.slice(2));
    if (w) event = { name: w.name, description: w.description, workout_doc: w.workout_doc, library: true, hrControl: w.hrControl };
  }
  selectedKey = event ? key : 'none';
  if (event) {
    const ride = event.sport === 'ride';
    const z = app.zonesFor(event);
    const needsProfile = ride ? !z?.ftp : event.library && !app.state.zones?.thresholdKmh;
    const hrControl = hrControllable(event);
    const hrOn = hrControl && $('wHrAdjust').checked;
    const steps = flattenWorkout(resolveDoc(event.workout_doc, z), {
      position: $('wPosition').value,
      defaultIncline: parseFloat($('wIncline').value) || 0,
      zones: z,
      hrTargets: hrOn,
    });
    app.setSelection({ key, event, steps, needsProfile, hrControl, hrOn });
  } else {
    app.setSelection(null);
  }
  settings.set('workout', selectedKey.startsWith('l:') ? selectedKey : '');
  markSelected();
  renderWorkout();
  render();
  updateChart();
  updateControls();
  updatePreview();
  updateRide();
}

const STEP_HEADS = {
  run: ['#', 'Step', 'Dur.', 'km/h', 'Pace', '%'],
  ride: ['#', 'Step', 'Dur.', 'W', 'HR'],
};

function renderStepHead(sport) {
  const tr = document.createElement('tr');
  STEP_HEADS[sport].forEach((text, i) => {
    const th = document.createElement('th');
    th.textContent = text;
    if (i > 1) th.className = 'r';
    tr.appendChild(th);
  });
  $('wStepsHead').replaceChildren(tr);
}

function renderWorkout() {
  const body = $('wSteps');
  const ride = app.state.selection?.event.sport === 'ride';
  $('wHrAdjustRow').hidden = !app.state.selection?.hrControl;
  $('wPosition').closest('label').hidden = $('wIncline').closest('label').hidden = ride;
  renderStepHead(ride ? 'ride' : 'run');
  if (!app.state.selection) {
    body.innerHTML = '';
    $('wName').textContent = $('wName').title = 'No workout: manual control';
    $('wDesc').textContent = 'On the Run tab you set speed and incline with the buttons.';
    $('wTotal').textContent = '';
    return;
  }
  $('wName').textContent = $('wName').title = app.state.selection.event.name || 'Workout'; // title: the full name when it is cut
  const missing = ride ? 'FTP is missing in Intervals.icu: without it, steps have no watts.\n' : 'Threshold pace is missing in Profile: without it, steps have no speed.\n';
  $('wDesc').textContent = (app.state.selection.needsProfile ? missing : '') +
    (app.state.selection.event.description || '') +
    (app.state.selection.hrOn ? '\n♥ Long steps follow their HR zone (speed starts at the planned pace); short ones keep their pace.' : '');
  if (ride) {
    body.innerHTML = app.state.selection.steps.map((s, i) => {
      const dur = s.duration ? formatDuration(s.duration) : s.distance ? `${(s.distance / 1000).toFixed(2)} km` : '—';
      const w = s.power ? (s.power.lo === s.power.hi ? s.power.lo : `${s.power.lo}–${s.power.hi}`) : '—';
      const hr = s.hr ? `${s.hr.lo}–${s.hr.hi}` : '—';
      return `<tr data-i="${i}"><td>${i + 1}</td><td>${escapeHtml(s.label)}</td><td class="r num">${dur}</td>` +
        `<td class="r num">${w}</td><td class="r num">${hr}</td></tr>`;
    }).join('');
    const sec = app.state.selection.steps.reduce((a, s) => a + (s.duration || 0), 0);
    $('wTotal').textContent = `${app.state.selection.steps.length} steps · ~${formatDuration(sec)}`;
    highlightSteps();
    return;
  }
  body.innerHTML = app.state.selection.steps.map((s, i) => {
    const dur = s.duration ? formatDuration(s.duration) : s.distance ? `${(s.distance / 1000).toFixed(2)} km` : '—';
    const spd = s.hasTarget ? (s.ramp ? `${s.speedStart}→${s.speedEnd}` : s.speedStart.toFixed(1)) : 'free';
    const pace = s.hasTarget ? (s.ramp ? `${formatPace(s.speedStart)}→${formatPace(s.speedEnd)}` : formatPace(s.speedStart)) : '—';
    return `<tr data-i="${i}"><td>${i + 1}</td><td>${escapeHtml(s.label)}</td><td class="r num">${dur}</td>` +
      `<td class="r num">${spd}</td><td class="r num">${pace}</td><td class="r num">${s.incline}</td></tr>`;
  }).join('');

  const totalSec = app.state.selection.steps.reduce((a, s) => a + (s.duration || (s.distance && s.speedStart ? s.distance / (s.speedStart / 3.6) : 0)), 0);
  const totalKm = app.state.selection.steps.reduce((a, s) => a + (s.distance || (s.duration && s.speedStart ? s.duration * ((s.speedStart + s.speedEnd) / 2) / 3.6 : 0)), 0) / 1000;
  $('wTotal').textContent = `${app.state.selection.steps.length} steps · ~${formatDuration(totalSec)} · ~${totalKm.toFixed(2)} km`;
  highlightSteps();
}

export function highlightSteps() {
  document.querySelectorAll('#wSteps tr').forEach((tr) => {
    const i = Number(tr.dataset.i);
    const active = session.state === 'running' || session.state === 'paused' || session.state === 'done';
    tr.classList.toggle('current', active && session.state !== 'done' && i === session.stepIdx);
    tr.classList.toggle('done', active && (i < session.stepIdx || session.state === 'done'));
  });
}

// Home: the sport filter
let homeSport = 'all';

// The chosen workout's chart, on this tab
export function updatePreview() {
  $('wPreview').update({ plan: planTimeline(true), samples: [], elapsed: 0, zones: app.zonesFor(app.state.selection?.event) });
}

/** Startup: wires Home and the workout page, restores the saved library choice and loads the library. */
export function initWorkouts() {
  // Home: the day and a sport filter
  $('hDate').value = today();
  $('hDate').onchange = loadWorkouts;
  homeSport = settings.get('homeSport') || 'all';
  $('hSport').value = homeSport;
  $('hSport').onchange = () => {
    homeSport = $('hSport').value;
    settings.set('homeSport', homeSport);
    renderLists();
  };
  $('hReload').onclick = loadWorkouts;
  // A workout picked in any list opens the workout page; during a session the lists are locked
  document.addEventListener('bw-select', (e) => {
    selectWorkout(e.detail.key);
    showTab('workout');
  });
  $('wPosition').onchange = () => selectWorkout();
  $('wIncline').onchange = () => selectWorkout();
  $('wHrAdjust').onchange = () => selectWorkout();

  const w = settings.get('workout');
  if (w?.startsWith('l:')) selectedKey = w; // confirmed once the library loads
  renderLists();
  loadLibrary().then((lib) => {
    LIBRARY = lib.entries;
    libTypes = lib.types;
    libDurations = lib.durations;
    log('info', `Library: ${LIBRARY.length} workouts`);
  }).catch((err) => {
    libError = err.message;
    log('error', `Library: ${err.message}`);
  }).finally(() => {
    renderLists();
    selectWorkout(selectedKey);
  });
}
