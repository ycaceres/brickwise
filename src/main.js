import { flattenWorkout, followsHr, targetSpeedAt, formatPace, formatDuration } from './workouts/steps.js';
import { buildTcx } from './export/tcx.js';
import { LIMITS } from './devices/treadmill/exp5i-protocol.js';
import { SessionChart } from './ui/chart.js';
import { samplesToCsv } from './export/csv.js';
import { MODE } from './devices/treadmill/ifit-messages.js';
import { every } from './lib/timer.js';
import { resolveDoc, hrZoneOf } from './physiology/zones.js';
import { loadLibrary } from './workouts/library.js';
import { alphaState, ALPHA_LABELS, VT1, VT2 } from './physiology/hrv.js';
import { hrDecision, hrSlope, inclineStep, SLOPE_WINDOW_S } from './session/hr-control.js';
import { analyzeRamp } from './physiology/thresholds.js';
import * as intervals from './services/intervals.js';
import { $, setPill, escapeHtml, download } from './lib/dom.js';
import { beep } from './lib/sound.js';
import { loadJson, saveJson, loadText, saveText } from './lib/storage.js';
import { live, rrState, rrActive, updateAlpha, STALE_MS } from './session/live.js';
import { log, renderConsole } from './ui/debug.js';
import { treadmill } from './ui/devices.js';
import { wakeError, requestWakeLock, releaseWakeLock } from './session/wake-lock.js';
import { zones, athlete, setProfile, loadProfileFromIntervals, renderProfile, refreshAthlete, loadTests, testText, renderTests } from './ui/profile.js';

const TICK_MS = 250;
const MOVING_KMH = 0.5;      // above this the belt is moving
const AUTO_PAUSE_MS = 2000;  // belt stopped this long → pause

// Speed adjustment by HR (steps carry the HR range of their zones)
const HR_GRACE_S = 45;       // at the start of a step HR takes a while to respond
const HR_HOLD_S = 10;        // the same correction must be asked for this long in a row
const HR_SPACING_S = 25;     // between one adjustment and the next
const HR_MAX_DOWN = 2.0;     // at most this much below the target
const HR_MAX_UP = 1.5;       // only on steps with an HR target
const ALPHA_HOLD_S = 60;     // α1 below VT1 this long on an aerobic step → slow down
const ALPHA_MIN_S = 120;     // into the session before α1 is trusted (full 2 min window)
const WARMUP_HOLD_S = 5;     // HR at the top of Z1 this long ends a warm-up ramp
const INCLINE_SPACING_S = 40; // between incline adjustments (the motor is slow and noisy)
const TEST_STOP_ALPHA = 0.45; // the threshold test ends once α1 is this far past VT2…
const TEST_STOP_HOLD_S = 20;  // …for this long
const TEST_MIN_S = 180;       // and never before this much ramp
const TESTS_KEPT = 20;        // threshold tests kept in the history

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
  if (name === 'workouts') preview.update({ plan: planTimeline(true), samples: [], elapsed: 0, zones });
}
for (const t of TABS) $(`nav-${t}`).onclick = () => showTab(t);
$('pillIntervals').onclick = () => showTab('profile');

// ---------------------------------------------------------------------------
// Workouts: planned in Intervals.icu and library
// ---------------------------------------------------------------------------
let workouts = null;       // planned in Intervals.icu (null = not loaded)
let selected = null;       // { event, steps }
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
  preview.update({ plan: planTimeline(true), samples: [], elapsed: 0, zones });
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

function highlightSteps() {
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
$('btnGoTrain').onclick = () => showTab('train');

// ---------------------------------------------------------------------------
// Session and workout execution
// ---------------------------------------------------------------------------
const session = {
  state: 'idle', // idle | armed | running | paused | done
  steps: [],
  stepIdx: 0,
  stepElapsed: 0,
  stepDist: 0,
  totalElapsed: 0,
  totalDist: 0,
  adjust: 0,
  hrAdjust: 0,        // km/h the HR adjustment removed (or added) in this step
  hrOutSince: null,   // since when (step s) the same correction has been asked for
  hrWantDir: 0,       // direction of that correction: -1, 0 or 1
  hrLastAdjust: null, // step s of the last HR adjustment
  alphaLowSince: null, // session s since α1 has been below VT1
  warmupHrSince: null, // step s since HR has been at the top of Z1 in a warm-up ramp
  target: null,       // km/h the page is requesting right now
  stopSince: null,
  samples: [],
  lastSampleAt: 0,
  startedAt: null,
  event: null,
  lastBeep: null,
  stepStarts: [],     // session time (s) when each step started
};

function resetSession() {
  Object.assign(session, {
    state: 'idle', steps: [], stepIdx: 0, stepElapsed: 0, stepDist: 0, totalElapsed: 0, totalDist: 0,
    adjust: 0, hrAdjust: 0, hrOutSince: null, hrWantDir: 0, hrOn: false, hrLastAdjust: null, inclineAdjust: 0, testStart: null, testEnd: null, testLowSince: null, testMarks: {}, alphaLowSince: null, warmupHrSince: null, target: null, stopSince: null, samples: [], lastSampleAt: 0, startedAt: null, event: null, lastBeep: null,
    stepStarts: [], uploaded: false,
  });
}

function currentStep() {
  return session.steps[session.stepIdx] || null;
}

function stepProgress(step) {
  if (!step) return 0;
  if (step.duration) return session.stepElapsed / step.duration;
  if (step.distance) return session.stepDist / step.distance;
  return 0;
}

function applyStep(i) {
  session.stepIdx = i;
  session.stepStarts[i] = session.totalElapsed;
  session.stepElapsed = 0;
  session.stepDist = 0;
  session.adjust = 0;
  session.hrAdjust = 0;
  session.inclineAdjust = 0;
  session.hrOutSince = null;
  session.hrWantDir = 0;
  session.hrLastAdjust = null;
  session.warmupHrSince = null;
  session.lastBeep = null;
  const step = currentStep();
  if (step?.test) session.testStart ??= session.totalElapsed;
  else if (session.testStart != null) session.testEnd ??= session.totalElapsed;
  if (!step) {
    finish('Workout complete. Belt paused: finish or resume from the console.');
    treadmill?.pause();
    return;
  }
  log('info', `Step ${i + 1}/${session.steps.length}: ${step.label}`);
  beep(i === 0 ? 660 : 880, 0.25);
  pushIncline();
  pushTarget(true);
  highlightSteps();
}

/** Sends the step's incline plus what HR moved it (steps that follow HR by incline). */
function pushIncline() {
  const step = currentStep();
  if (!step) return;
  treadmill?.setIncline(Math.min(LIMITS.inclineMax, Math.max(LIMITS.inclineMin, step.incline + session.inclineAdjust)));
}

/** Sends the target speed if it changed (ramps and manual adjustments). */
function pushTarget(force = false) {
  const step = currentStep();
  if (!step?.hasTarget) { session.target = null; return; }
  const base = targetSpeedAt(step, stepProgress(step));
  const t = Math.round(Math.min(LIMITS.speedMax, Math.max(LIMITS.speedMin, base + session.adjust + session.hrAdjust)) * 10) / 10;
  if (force || t !== session.target) {
    session.target = t;
    treadmill?.setSpeed(t);
  }
}

function start() {
  resetSession();
  session.steps = selected ? selected.steps : [];
  session.event = selected ? selected.event : null;
  session.hrOn = !!selected?.hrOn;
  session.state = 'armed';
  requestWakeLock();
  updateControls();
  updateChart();
}

function finish(message) {
  if (session.state === 'idle' || session.state === 'done') return;
  session.state = 'done';
  session.target = null;
  releaseWakeLock();
  log('info', message);
  $('sessionNote').textContent = message;
  if (session.steps.length) session.stepStarts[session.stepIdx + 1] ??= session.totalElapsed;
  if (session.testStart != null) {
    session.testEnd ??= session.totalElapsed;
    saveTestResult();
  }
  highlightSteps();
  updateControls();
  updateChart();
  beep(520, 0.6);
}

function tick() {
  const now = Date.now();
  updateAlpha();
  // Up to 5 s: with the tab hidden ticks may spread out without losing distance
  const dt = Math.min(5, (now - (tick.last || now)) / 1000);
  tick.last = now;
  // Without recent treadmill data no distance is counted (and the session pauses)
  if (!treadmill || now - treadmill.state.updatedAt > STALE_MS) live.speed = 0;
  const moving = live.speed >= MOVING_KMH;
  const restarted = moving && !tick.wasMoving;
  tick.wasMoving = moving;

  if (session.state === 'armed' && moving) {
    session.state = 'running';
    session.startedAt = now;
    rrState.pending = []; // beats from before the start do not belong to the first sample
    log('info', 'Belt moving: session started');
    if (session.steps.length) applyStep(0);
    updateControls();
  } else if (session.state === 'running') {
    // The belt stopped and restarted before the auto-pause: the console
    // restarts at its own speed, so the target is resent
    if (restarted) {
      const step = currentStep();
      if (step) { pushIncline(); pushTarget(true); }
    }
    if (!moving) {
      session.stopSince ??= now;
      if (now - session.stopSince > AUTO_PAUSE_MS) {
        session.state = 'paused';
        log('warn', 'Belt stopped: session paused');
        updateControls();
      }
    } else {
      session.stopSince = null;
    }
  } else if (session.state === 'paused' && moving) {
    session.state = 'running';
    session.stopSince = null;
    rrState.pending = [];
    log('info', 'Belt moving: session resumed');
    const step = currentStep();
    if (step) { pushIncline(); pushTarget(true); }
    updateControls();
  }

  if (session.state === 'running') {
    const meters = (live.speed / 3.6) * dt;
    session.totalElapsed += dt;
    session.totalDist += meters;
    session.stepElapsed += dt;
    session.stepDist += meters;

    if (now - session.lastSampleAt >= 1000) {
      session.lastSampleAt = now;
      const sample = {
        t: now, elapsed: session.totalElapsed, distance: session.totalDist,
        speed: live.speed, incline: live.incline, hr: live.hr, target: session.target,
      };
      // α1 only with RR: null = no value yet or bad signal
      if (rrActive()) {
        sample.alpha1 = rrState.alpha?.alpha1 ?? null;
        sample.rr = rrState.pending;
      }
      rrState.pending = [];
      session.samples.push(sample);
    }

    const step = currentStep();
    if (step) {
      if (step.duration) {
        const left = Math.ceil(step.duration - session.stepElapsed);
        if (left <= 3 && left >= 1 && session.lastBeep !== left) {
          session.lastBeep = left;
          beep(440, 0.12);
        }
      }
      const testEnd = testOver(step);
      if (testEnd) {
        log('info', `Threshold test: ${testEnd}, ramp over`);
        const cd = session.steps.findIndex((s, i) => i > session.stepIdx && !s.test);
        applyStep(cd < 0 ? session.steps.length : cd);
      } else if (stepProgress(step) >= 1) applyStep(session.stepIdx + 1);
      else if (warmupDone(step)) {
        log('info', `HR ${live.hr} reached the top of Z1 (${zones.hr[0].hi}): warm-up done`);
        applyStep(session.stepIdx + 1);
      } else {
        adjustForHr(step);
        if (step.ramp) pushTarget();
      }
    }
  }

  render();
  if (session.state === 'running' && now - (tick.lastChart || 0) >= 1000) {
    tick.lastChart = now;
    updateChart();
  }
}

/**
 * A warm-up ramp ends early once HR has been at or above the top of Z1 for
 * WARMUP_HOLD_S: going on would only push HR further up before the main set.
 * Only before an aerobic step (Z1–Z2): harder sets keep the whole warm-up.
 */
function warmupDone(step) {
  if (!step.warmup || !step.ramp || !zones?.hr.length || !live.hr) return false;
  const next = session.steps[session.stepIdx + 1];
  if (!next || next.zone == null || next.zone > 2) return false;
  if (live.hr < zones.hr[0].hi) { session.warmupHrSince = null; return false; }
  session.warmupHrSince ??= session.stepElapsed;
  return session.stepElapsed - session.warmupHrSince >= WARMUP_HOLD_S;
}

/**
 * Threshold test ramp: why it should end now, or null. It ends once α1 has
 * stayed below TEST_STOP_ALPHA (just past VT2) or HR gets near max HR. On the
 * way it logs when α1 crosses VT1 and VT2.
 */
function testOver(step) {
  if (!step.test) return null;
  const a = rrActive() ? rrState.alpha?.alpha1 : null;
  for (const [name, limit] of [['VT1', VT1], ['VT2', VT2]]) {
    if (a != null && a < limit && !session.testMarks[name]) {
      session.testMarks[name] = true;
      log('info', `α1 ${a.toFixed(2)} with HR ${live.hr}: around ${name}`);
    }
  }
  if (zones?.maxHr && live.hr >= zones.maxHr - 2) return `HR ${live.hr} near max HR ${zones.maxHr}`;
  if (a == null || a >= TEST_STOP_ALPHA || session.totalElapsed - session.testStart < TEST_MIN_S) {
    session.testLowSince = null;
    return null;
  }
  session.testLowSince ??= session.totalElapsed;
  return session.totalElapsed - session.testLowSince >= TEST_STOP_HOLD_S ? `α1 below ${TEST_STOP_ALPHA}` : null;
}

/** Analyzes the threshold test that just ended and keeps it in the history (Profile). */
function saveTestResult() {
  const result = analyzeRamp(session.samples, session.testStart, session.testEnd);
  const peakHr = Math.max(0, ...session.samples.map((s) => s.hr || 0));
  if (result.error) {
    log('warn', `Threshold test: ${result.error}`);
    $('sessionNote').textContent += ` Threshold test: ${result.error}`;
    return;
  }
  const tests = [{ date: new Date().toISOString(), ...result, peakHr }, ...loadTests()].slice(0, TESTS_KEPT);
  saveJson('tests', tests);
  const text = testText(result);
  log('info', `Threshold test: ${text} (r² ${result.r2}, ${result.points} points)`);
  $('sessionNote').textContent += ` Threshold test: ${text}. See Profile.`;
  renderTests();
}

/** α1 has been below VT1 for ALPHA_HOLD_S with a clean signal (tracked every tick). */
function alphaLow() {
  const a = rrActive() ? rrState.alpha?.alpha1 : null;
  if (a == null || a >= VT1 || session.totalElapsed < ALPHA_MIN_S) { session.alphaLowSince = null; return false; }
  session.alphaLowSince ??= session.totalElapsed;
  return session.totalElapsed - session.alphaLowSince >= ALPHA_HOLD_S;
}

/**
 * Speed adjustment by HR, once per tick while a step runs (the decision is
 * in session/hr-control.js).
 * - Step with a pace target ('cap'): speed drops when HR is heading above
 *   the top of the matching zone; once HR is back below, it returns.
 * - Step with an HR target ('target'): speed moves to keep HR in the middle
 *   of the range.
 * - Aerobic steps (Z1–Z2): speed also drops while α1 stays below VT1.
 * The same correction must be asked for HR_HOLD_S in a row, and at least
 * HR_SPACING_S pass between adjustments, because HR responds with a lag.
 */
function adjustForHr(step) {
  const low = alphaLow();
  if (!session.hrOn || !step.hr || step.hr.mode === 'info' || !step.hasTarget || !live.hr) return;
  const t = session.stepElapsed;
  if (t < (step.hr.settle ?? HR_GRACE_S)) return;
  const { lo, hi, mode } = step.hr;
  const recent = session.samples.filter((s) => s.elapsed > session.totalElapsed - SLOPE_WINDOW_S);
  const { delta, reason } = hrDecision({
    mode, lo, hi, hr: live.hr, slope: hrSlope(recent), hrAdjust: session.hrAdjust,
    alphaLow: low && step.zone != null && step.zone <= 2,
  });
  const dir = Math.sign(delta);
  if (!dir) { session.hrOutSince = null; session.hrWantDir = 0; return; }
  if (dir !== session.hrWantDir) { session.hrWantDir = dir; session.hrOutSince = t; }
  if (t - session.hrOutSince < HR_HOLD_S) return;
  const byIncline = step.hr.by === 'incline';
  if (session.hrLastAdjust != null && t - session.hrLastAdjust < (byIncline ? INCLINE_SPACING_S : HR_SPACING_S)) return;
  if (byIncline) {
    // The incline moves within the treadmill's range; speed stays as planned
    const next = Math.min(LIMITS.inclineMax - step.incline, Math.max(LIMITS.inclineMin - step.incline, session.inclineAdjust + inclineStep(delta)));
    if (next === session.inclineAdjust) return;
    const applied = next - session.inclineAdjust;
    session.inclineAdjust = next;
    log('info', `${reason}: incline ${applied > 0 ? '+' : '−'}${Math.abs(applied).toFixed(1)} %, now ${(step.incline + next).toFixed(1)} %`);
    pushIncline();
  } else {
    const maxUp = mode === 'target' ? HR_MAX_UP : 0;
    const next = Math.round(Math.min(maxUp, Math.max(-HR_MAX_DOWN, session.hrAdjust + delta)) * 10) / 10;
    if (next === session.hrAdjust) return;
    const applied = Math.round((next - session.hrAdjust) * 10) / 10;
    session.hrAdjust = next;
    log('info', `${reason}: speed ${applied > 0 ? '+' : '−'}${Math.abs(applied).toFixed(1)} km/h, HR adjustment ${next > 0 ? '+' : ''}${next.toFixed(1)}`);
    pushTarget();
  }
  session.hrLastAdjust = t;
  session.hrOutSince = null;
  session.hrWantDir = 0;
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------
const chart = new SessionChart($('chart'));
const preview = new SessionChart($('wPreview')); // the chosen workout, on the Workouts tab

/** Estimated duration of a step (distance steps are converted with their target). */
function plannedSeconds(step) {
  if (step.duration) return step.duration;
  const kmh = step.hasTarget ? (step.speedStart + step.speedEnd) / 2 : 8;
  return step.distance ? step.distance / (kmh / 3.6) : 60;
}

/**
 * Plan blocks in session time. Steps already done use their actual start and
 * end (skips, pauses or distance steps); the rest are chained with their
 * planned duration.
 */
function planTimeline(planOnly = false) {
  const active = !planOnly && session.state !== 'idle';
  const steps = active ? session.steps : selected?.steps || [];
  const out = [];
  let t = 0;
  steps.forEach((step, i) => {
    const started = active ? session.stepStarts[i] : undefined;
    const t0 = started ?? t;
    let t1 = session.stepStarts[i + 1];
    if (t1 == null || !active) {
      t1 = t0 + plannedSeconds(step);
      if (active && i === session.stepIdx && session.state !== 'done') {
        // Current step: what is left given its progress
        t1 = Math.max(session.totalElapsed, t0 + plannedSeconds(step));
      }
    }
    out.push({
      t0, t1, speedStart: step.speedStart, speedEnd: step.speedEnd, incline: step.incline,
      zone: step.zone, hr: step.hr, intensity: step.intensity,
    });
    t = t1;
  });
  return out;
}

function updateChart() {
  const event = session.state !== 'idle' ? session.event : selected?.event;
  chart.update({ plan: planTimeline(), samples: session.samples, elapsed: session.totalElapsed, zones });
  $('chartTitle').textContent = event?.name || 'Free session';
}

$('btnCsv').onclick = () => {
  $('menuExport').hidePopover();
  if (!session.samples.length) return;
  download(`brickwise-${new Date(session.startedAt).toISOString().slice(0, 16).replace(':', '')}.csv`, samplesToCsv(session.samples), 'text/csv');
};

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
document.querySelectorAll('[data-speed]').forEach((btn) => {
  btn.onclick = () => {
    const delta = parseFloat(btn.dataset.speed);
    if (currentStep()?.hasTarget && session.state === 'running') {
      session.adjust = Math.round((session.adjust + delta) * 10) / 10;
      pushTarget();
    } else {
      // Base: the requested speed the console reports (includes changes made on it)
      const reported = live.console.targetSpeed;
      const base = reported > 0 ? reported : session.target ?? live.speed;
      session.target = Math.round(Math.min(LIMITS.speedMax, Math.max(LIMITS.speedMin, base + delta)) * 10) / 10;
      treadmill?.setSpeed(session.target);
    }
  };
});

document.querySelectorAll('[data-incline]').forEach((btn) => {
  btn.onclick = () => treadmill?.setIncline(live.incline + parseFloat(btn.dataset.incline));
});

$('btnStart').onclick = start;
$('btnSkip').onclick = () => {
  if (session.state === 'running' || session.state === 'paused') applyStep(session.stepIdx + 1);
};
$('btnFinish').onclick = () => {
  if (session.state === 'armed') { resetSession(); releaseWakeLock(); updateControls(); return; }
  finish('Session ended. Belt paused: finish or resume from the console.');
  treadmill?.pause();
};

export function updateControls() {
  const connected = !!treadmill?.connected;
  const active = ['armed', 'running', 'paused'].includes(session.state);
  $('btnStart').disabled = !connected || active;
  const startLabel = selected ? 'Start workout' : 'Start free session';
  $('btnStart').title = startLabel;
  $('btnStart').setAttribute('aria-label', startLabel);
  $('btnSkip').disabled = !(session.steps.length && (session.state === 'running' || session.state === 'paused'));
  $('btnFinish').disabled = !active;
  const finished = session.state === 'done' && session.samples.length > 0;
  $('btnExport').disabled = !finished;
  $('btnUpload').disabled = !(finished && session.samples.length > 10 && intervals.getApiKey() && !session.uploaded);
  $('btnUpload').title = intervals.getApiKey() ? 'Upload to Intervals.icu (when finished)' : 'Upload to Intervals.icu: sign in with your API key in Profile';
  $('wPosition').disabled = $('wIncline').disabled = $('wHrAdjust').disabled = active;
  document.querySelectorAll('.witem').forEach((b) => { b.disabled = active; });
  document.querySelectorAll('[data-speed],[data-incline]').forEach((b) => { b.disabled = !connected; });

  const notes = {
    idle: connected ? 'Pick a workout (or none) and press Start.' : 'Connect the treadmill to begin.',
    armed: 'Press START on the console. The workout begins as soon as the belt moves.',
    running: session.steps.length ? 'Workout in progress.' : 'Free session in progress.',
    paused: 'Paused: the belt is stopped. Press START on the console to continue.',
  };
  if (notes[session.state]) $('sessionNote').textContent = notes[session.state];
  if (wakeError && ['armed', 'running', 'paused'].includes(session.state)) {
    $('sessionNote').textContent += ` ${wakeError}`;
  }
  if (session.state === 'idle' && selected?.needsProfile) {
    $('sessionNote').textContent = 'Threshold pace is missing in Profile: without it, this workout has no speeds.';
  }
  if (connected && live.console.mode === MODE.MISSING_SAFETY_KEY) {
    $('sessionNote').textContent = 'Safety key missing: attach it to the console.';
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
function render() {
  $('mPace').textContent = formatPace(live.speed);
  const offTarget = session.target != null && session.state === 'running' && Math.abs(live.speed - session.target) > 0.15;
  $('mPace').classList.toggle('off-target', offTarget);
  $('mSpeedSub').textContent = `${live.speed.toFixed(1)} km/h` +
    (session.target != null ? ` · target ${formatPace(session.target)}` : '');
  $('mIncline').textContent = live.incline.toFixed(1);
  const planned = ['running', 'paused'].includes(session.state) ? currentStep()?.incline : null;
  $('mInclineSub').textContent = planned != null ? `target ${planned} %` : '\u00a0';
  $('mDist').textContent = (session.totalDist / 1000).toFixed(2);
  $('mTime').textContent = formatDuration(session.totalElapsed);
  const hz = hrZoneOf(zones, live.hr);
  $('mHr').textContent = live.hr || '--';
  $('mHrSub').textContent = `bpm${hz ? ` · Z${hz}` : ''}`;
  $('mHr').parentElement.title = `Heart rate${live.hrSource === 'console' ? ' (from the console)' : live.hrSource === 'strap' ? ' (from the strap)' : ''}`;
  renderAlpha();
  renderConsole();
}

/** α1 in the bar, to the right of HR. */
function renderAlpha() {
  const box = $('mAlphaBox');
  box.classList.toggle('hidden', !rrActive());
  if (!rrActive()) return;
  const a = rrState.alpha;
  const state = alphaState(a?.alpha1);
  box.dataset.state = state || 'none';
  $('mAlpha').textContent = a?.alpha1 != null ? a.alpha1.toFixed(2) : '--';
  $('mAlphaSub').textContent = a?.alpha1 != null ? `α1 · ${ALPHA_LABELS[state]}`
    : rrState.contact === false ? 'α1 · no contact'
      : a?.reason === 'noisy signal' ? `α1 · noisy signal (${Math.round(a.artifactPct)} %)`
        : 'α1 · computing…';
  box.title = 'DFA α1 over the last 2 min: > 0.75 aerobic, 0.5–0.75 transition, < 0.5 above the anaerobic threshold' +
    (a ? ` · ${a.beats} beats, ${a.artifactPct.toFixed(1)} % artifacts` : '');
}

// ---------------------------------------------------------------------------
// Export and upload
// ---------------------------------------------------------------------------
function activityName() {
  return session.event ? `${session.event.name} (treadmill)` : 'Treadmill run';
}

const fromExport = (fn) => () => { $('menuExport').hidePopover(); fn(); };
$('menuExport').addEventListener('toggle', (e) => {
  if (e.newState !== 'open') return;
  const r = $('btnExport').getBoundingClientRect();
  const m = $('menuExport');
  m.style.top = `${r.bottom + 6}px`;
  m.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8))}px`;
});

$('btnTcx').onclick = fromExport(() => {
  const tcx = buildTcx(session.samples, { name: activityName() });
  download(`brickwise-${new Date(session.startedAt).toISOString().slice(0, 16).replace(':', '')}.tcx`, tcx, 'application/vnd.garmin.tcx+xml');
});

$('btnUpload').onclick = async () => {
  const btn = $('btnUpload');
  const note = $('sessionNote');
  btn.disabled = true;
  note.textContent = 'Uploading to Intervals.icu…';
  try {
    const tcx = buildTcx(session.samples, { name: activityName() });
    const meta = {
      name: activityName(),
      description: `NordicTrack EXP 5i controlled by Brickwise. Base incline ${$('wIncline').value}%. Pace ${$('wPosition').selectedOptions[0].text.toLowerCase()} within the zone.`,
      external_id: `brickwise-${session.startedAt}`,
      paired_event_id: session.event?.id,
    };
    const data = await intervals.uploadTcx(tcx, meta);
    const id = data.id || data.activities?.[0]?.id;
    session.uploaded = true;
    note.textContent = 'Activity uploaded. ';
    if (id) {
      const a = Object.assign(document.createElement('a'), {
        href: `https://intervals.icu/activities/${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener', textContent: 'View on Intervals.icu',
      });
      note.appendChild(a);
    }
    log('info', `Activity uploaded to Intervals.icu ${id || ''}`);
  } catch (err) {
    note.textContent = `Upload failed: ${err.message}`;
    log('error', `Upload: ${err.message}`);
    btn.disabled = false;
  }
};

// ---------------------------------------------------------------------------
// Closing the page
// ---------------------------------------------------------------------------
// Closing or reloading the page during an active workout pauses the belt.
// It happens on beforeunload (while the browser asks whether to leave there
// is time for the command to arrive) and again on pagehide in case nobody
// was asked. If you stay, the session remains paused: START on the console
// resumes it.
let unloadPausedAt = 0;
function pauseOnClose() {
  if (!['armed', 'running', 'paused'].includes(session.state) || !treadmill?.connected) return;
  if (Date.now() - unloadPausedAt < 1000) return;
  unloadPausedAt = Date.now();
  treadmill.pauseNow();
}
window.addEventListener('beforeunload', (e) => {
  if (!['armed', 'running', 'paused'].includes(session.state)) return;
  pauseOnClose();
  e.preventDefault();
});
window.addEventListener('pagehide', pauseOnClose);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
{
  const saved = loadJson('profile');
  const tab = loadText('tab');
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
