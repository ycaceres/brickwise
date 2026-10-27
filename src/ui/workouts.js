/**
 * Workouts tab: the runs planned in Intervals.icu for a day, the library
 * with its filters, and the chosen workout (steps, totals and chart).
 */

import { $, setPill, escapeHtml } from '../lib/dom.js';
import { loadJson, saveJson, loadText, saveText } from '../lib/storage.js';
import { flattenWorkout, followsHr, formatPace, formatDuration } from '../workouts/steps.js';
import { loadLibrary } from '../workouts/library.js';
import { resolveDoc } from '../physiology/zones.js';
import * as intervals from '../services/intervals.js';
import { SessionChart } from './chart.js';
import { log } from './debug.js';
import { zones } from './profile.js';
import { session } from '../session/runner.js';
import { render, updateChart, updateControls, planTimeline } from './train.js';

let workouts = null;       // planned in Intervals.icu (null = not loaded)
export let selected = null;       // { event, steps }
export let selectedKey = 'none';  // 'none' | 'i:<index>' | 'l:<id>'

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export async function loadWorkouts() {
  const day = $('wDate').value || today();
  $('wPlanned').replaceChildren(listNote('Loading…'));
  if (!intervals.getApiKey()) {
    workouts = [];
    setPill('pillIntervals', 'idle', 'Intervals.icu: no API key');
    renderLists();
    selectWorkout(selectedKey.startsWith('i:') ? 'none' : selectedKey);
    return;
  }
  setPill('pillIntervals', 'busy', 'Intervals.icu: loading…');
  try {
    workouts = await intervals.getWorkouts(day, day);
    setPill('pillIntervals', 'ready', `Intervals.icu: ${workouts.length} workout(s) on ${day}`);
  } catch (err) {
    workouts = [];
    setPill('pillIntervals', 'error', 'Intervals.icu: offline');
    log('error', `Intervals.icu: ${err.message}`);
  }
  if (selectedKey.startsWith('i:')) selectedKey = 'none';
  if (selectedKey === 'none' && workouts.length) selectedKey = 'i:0';
  renderLists();
  selectWorkout(selectedKey);
}

function listNote(text) {
  const div = document.createElement('div');
  div.className = 'note';
  div.textContent = text;
  return div;
}

function workoutItem(key, title, sub, hrControl = false) {
  const btn = document.createElement('button');
  btn.className = 'witem';
  btn.dataset.key = key;
  const strong = document.createElement('strong');
  strong.textContent = title;
  if (hrControl) {
    const tag = document.createElement('em');
    tag.className = 'hr-tag';
    tag.textContent = '♥ HR';
    tag.title = 'Speed can follow your heart rate';
    strong.append(' ', tag);
  }
  const span = document.createElement('span');
  span.textContent = sub;
  btn.append(strong, span);
  btn.onclick = () => selectWorkout(key);
  return btn;
}

/**
 * Whether HR can steer a workout: library workouts say so (hrControl), the
 * Intervals.icu ones are judged by their steps.
 */
function hrControllable(w) {
  if (w.hrControl != null) return w.hrControl;
  return followsHr(flattenWorkout(resolveDoc(w.workout_doc, zones), { zones }));
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
const libFilter = { minutes: 45, type: 'all', level: 'all', ...loadJson('libFilter', {}) };

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
      saveJson('libFilter', libFilter);
      renderLists();
    };
    wrap.appendChild(sel);
    box.appendChild(wrap);
  };
  select('Duration', 'minutes', [['all', 'All'], ...libDurations.map((m) => [m, `${m} min`])]);
  select('Type', 'type', [['all', 'All'], ...libTypes.map((t) => [t.id, t.name])]);
  select('Level', 'level', [['all', 'All'], ...[1, 2, 3, 4, 5].map((n) => [n, String(n)])]);
}

function renderLists() {
  const planned = $('wPlanned');
  planned.replaceChildren();
  if (workouts?.length) {
    workouts.forEach((w, i) => {
      const sec = docSeconds(w.workout_doc);
      planned.appendChild(workoutItem(`i:${i}`, w.name || 'Workout', sec ? `~${formatDuration(sec)}` : '', hrControllable(w)));
    });
  } else {
    planned.appendChild(listNote(workouts ? 'No runs planned that day.' : 'Loading…'));
  }
  renderFilters();
  const lib = $('wLibrary');
  lib.replaceChildren(workoutItem('none', 'No workout', 'Manual speed and incline control'));
  if (libError) lib.appendChild(listNote(`Could not load the library: ${libError}`));
  else if (!LIBRARY.length) lib.appendChild(listNote('Loading library…'));
  const shown = LIBRARY.filter(libraryMatches);
  for (const w of shown) {
    const item = workoutItem(`l:${w.id}`, w.featured ? `★ ${w.name} · ${w.minutes} min` : w.name, w.summary, w.hrControl);
    lib.appendChild(item);
  }
  if (LIBRARY.length && !shown.length) lib.appendChild(listNote('No workouts match those filters.'));
  $('wLibCount').textContent = LIBRARY.length ? `${shown.length} of ${LIBRARY.length}` : '';
  markSelected();
}

function markSelected() {
  document.querySelectorAll('.witem').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === selectedKey)));
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
    const needsProfile = event.library && !zones?.thresholdKmh;
    const hrControl = hrControllable(event);
    const hrOn = hrControl && $('wHrAdjust').checked;
    const steps = flattenWorkout(resolveDoc(event.workout_doc, zones), {
      position: $('wPosition').value,
      defaultIncline: parseFloat($('wIncline').value) || 0,
      zones,
      hrTargets: hrOn,
    });
    selected = { event, steps, needsProfile, hrControl, hrOn };
  } else {
    selected = null;
  }
  saveText('workout', selectedKey.startsWith('l:') ? selectedKey : '');
  markSelected();
  renderWorkout();
  render();
  updateChart();
  updateControls();
  updatePreview();
}

function renderWorkout() {
  const body = $('wSteps');
  $('wHrAdjustRow').hidden = !selected?.hrControl;
  if (!selected) {
    body.innerHTML = '';
    $('wName').textContent = 'No workout: manual control';
    $('wDesc').textContent = 'On the Train tab you set speed and incline with the buttons.';
    $('wTotal').textContent = '';
    return;
  }
  $('wName').textContent = selected.event.name || 'Workout';
  $('wDesc').textContent = (selected.needsProfile ? 'Threshold pace is missing in Profile: without it, steps have no speed.\n' : '') +
    (selected.event.description || '') +
    (selected.hrOn ? '\n♥ Long steps follow their HR zone (speed starts at the planned pace); short ones keep their pace.' : '');
  body.innerHTML = selected.steps.map((s, i) => {
    const dur = s.duration ? formatDuration(s.duration) : s.distance ? `${(s.distance / 1000).toFixed(2)} km` : '—';
    const spd = s.hasTarget ? (s.ramp ? `${s.speedStart}→${s.speedEnd}` : s.speedStart.toFixed(1)) : 'free';
    const pace = s.hasTarget ? (s.ramp ? `${formatPace(s.speedStart)}→${formatPace(s.speedEnd)}` : formatPace(s.speedStart)) : '—';
    return `<tr data-i="${i}"><td>${i + 1}</td><td>${escapeHtml(s.label)}</td><td class="r num">${dur}</td>` +
      `<td class="r num">${spd}</td><td class="r num">${pace}</td><td class="r num">${s.incline}</td></tr>`;
  }).join('');

  const totalSec = selected.steps.reduce((a, s) => a + (s.duration || (s.distance && s.speedStart ? s.distance / (s.speedStart / 3.6) : 0)), 0);
  const totalKm = selected.steps.reduce((a, s) => a + (s.distance || (s.duration && s.speedStart ? s.duration * ((s.speedStart + s.speedEnd) / 2) / 3.6 : 0)), 0) / 1000;
  $('wTotal').textContent = `${selected.steps.length} steps · ~${formatDuration(totalSec)} · ~${totalKm.toFixed(2)} km`;
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

$('wDate').value = today();
$('wDate').onchange = loadWorkouts;
$('btnReload').onclick = loadWorkouts;
$('wPosition').onchange = () => selectWorkout();
$('wIncline').onchange = () => selectWorkout();
$('wHrAdjust').onchange = () => selectWorkout();

// The chosen workout's chart, on this tab
const preview = new SessionChart($('wPreview'));
export function updatePreview() {
  preview.update({ plan: planTimeline(true), samples: [], elapsed: 0, zones });
}

/** Startup: restores the saved library choice and loads the library. */
export function initWorkouts() {
  const w = loadText('workout');
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
