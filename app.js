import { Exp5iTreadmill, SimulatedTreadmill, HeartRateStrap } from './treadmill.js';
import { flattenWorkout, targetSpeedAt, formatPace, formatDuration } from './workout.js';
import { buildTcx } from './tcx.js';
import { LIMITS } from './exp5i-protocol.js';
import { SessionChart, samplesToCsv } from './chart.js';
import { MODES, MODE, PULSE_SOURCES } from './ifit-messages.js';
import { every } from './timer.js';
import { zonesFromProfile, profileFromIntervals, resolveDoc, hrZoneOf, DEFAULT_PACE_PCT, DEFAULT_HR_PCT } from './zones.js';
import { loadLibrary } from './library.js';
import { alpha1Window, alphaState, ALPHA_LABELS, VT1 } from './hrv.js';
import { hrDecision, hrSlope, SLOPE_WINDOW_S } from './hrcontrol.js';
import * as intervals from './intervals.js';

const $ = (id) => document.getElementById(id);
const TICK_MS = 250;
const MOVING_KMH = 0.5;      // above this the belt is moving
const AUTO_PAUSE_MS = 2000;  // belt stopped this long → pause
const STALE_MS = 3000;       // no notifications this long → speed unknown

// Speed adjustment by HR (steps carry the HR range of their zones)
const HR_GRACE_S = 45;       // at the start of a step HR takes a while to respond
const HR_HOLD_S = 10;        // the same correction must be asked for this long in a row
const HR_SPACING_S = 25;     // between one adjustment and the next
const HR_MAX_DOWN = 2.0;     // at most this much below the target
const HR_MAX_UP = 1.5;       // only on steps with an HR target
const ALPHA_HOLD_S = 60;     // α1 below VT1 this long on an aerobic step → slow down
const ALPHA_MIN_S = 120;     // into the session before α1 is trusted (full 2 min window)
const WARMUP_HOLD_S = 5;     // HR at the top of Z1 this long ends a warm-up ramp

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------
const logLines = [];
function log(kind, text) {
  const line = `${new Date().toISOString().slice(11, 23)} ${kind.toUpperCase().padEnd(5)} ${text}`;
  logLines.push(line);
  if (logLines.length > 20000) logLines.splice(0, 5000);
  if ((kind === 'tx' || kind === 'rx') && !$('logTraffic').checked) return;
  const el = document.createElement('div');
  el.className = kind;
  el.textContent = line;
  const box = $('log');
  box.appendChild(el);
  while (box.childElementCount > 400) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

function setPill(id, state, text) {
  const el = $(id);
  el.dataset.state = state;
  if (text) el.textContent = text;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------
let treadmill = null;
const live = { speed: 0, incline: 0, hr: null, hrSource: null, console: {}, info: {} };

// RR intervals (chest strap) and DFA α1 of the last 2 minutes
const ALPHA_EVERY_MS = 5000;
const rrState = { beats: [], lastAt: 0, alpha: null, computedAt: 0, pending: [] };

function addRr(list, contact) {
  const now = Date.now();
  // Each beat is timestamped backwards from now, in arrival order
  let t = now - list.slice(1).reduce((a, b) => a + b, 0);
  for (const rr of list) {
    rrState.beats.push({ t, rr });
    rrState.pending.push(rr);
    t += rr;
  }
  rrState.lastAt = now;
  rrState.contact = contact;
  const keep = now - 150_000;
  while (rrState.beats.length && rrState.beats[0].t < keep) rrState.beats.shift();
}

/** Recent RR: without them α1 is not shown (optical sensor, no strap…). */
const rrActive = () => Date.now() - rrState.lastAt < 10_000;

function updateAlpha() {
  const now = Date.now();
  if (!rrActive()) { rrState.alpha = null; return; }
  if (now - rrState.computedAt < ALPHA_EVERY_MS) return;
  rrState.computedAt = now;
  rrState.alpha = alpha1Window(rrState.beats, now);
}

function treadmillCallbacks() {
  return {
    onStatus: (state, detail) => {
      const map = {
        connecting: ['busy', 'Treadmill: connecting…'],
        initializing: ['busy', 'Treadmill: activating…'],
        ready: ['ready', `Treadmill: ${detail || 'ready'}`],
        disconnected: ['error', 'Treadmill: disconnected'],
      };
      const [s, t] = map[state] || ['error', `Treadmill: ${state}`];
      setPill('pillTreadmill', s, t);
      log(state === 'disconnected' ? 'warn' : 'info', t);
      if (state === 'disconnected') {
        live.speed = 0;
        live.console = {};
        if (live.hrSource === 'console') { live.hr = null; live.hrSource = null; }
      }
      const ready = state === 'ready';
      $('btnConnect').disabled = $('btnSim').disabled = ready || state === 'connecting' || state === 'initializing';
      $('btnDisconnect').disabled = !ready;
      $('btnSimBelt').classList.toggle('hidden', !(ready && treadmill?.simulated));
      updateControls();
    },
    onData: (state) => {
      live.speed = state.speed ?? 0;
      live.incline = state.incline ?? 0;
      live.console = state;
      // HR from the console (hand grips or a strap paired with the treadmill),
      // only if no strap is connected to the page
      if (hrStrap.bpm == null) {
        if (state.rr?.length) addRr(state.rr, null); // only the simulator sends RR this way
        const bpm = state.pulse?.bpm;
        live.hr = bpm > 0 ? bpm : null;
        live.hrSource = bpm > 0 ? 'console' : null;
      }
    },
    onInfo: (info) => {
      live.info = info;
      renderInfo();
    },
    onLog: log,
  };
}

async function connectTreadmill(simulated) {
  treadmill = simulated ? new SimulatedTreadmill(treadmillCallbacks()) : new Exp5iTreadmill(treadmillCallbacks());
  try {
    await treadmill.connect();
  } catch (err) {
    log('error', err.message);
    setPill('pillTreadmill', 'error', 'Treadmill: error');
    $('btnConnect').disabled = $('btnSim').disabled = false;
  }
}

// Treadmill menu: opens under its pill and closes on choice
const menu = $('menuTreadmill');
menu.addEventListener('toggle', (e) => {
  if (e.newState !== 'open') return;
  const r = $('pillTreadmill').getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
});
const fromMenu = (fn) => () => { menu.hidePopover(); fn(); };
$('btnConnect').onclick = fromMenu(() => connectTreadmill(false));
$('btnSim').onclick = fromMenu(() => connectTreadmill(true));
$('btnDisconnect').onclick = fromMenu(() => treadmill?.disconnect());
$('btnSimBelt').onclick = fromMenu(() => treadmill?.toggleBelt?.());

const hrStrap = new HeartRateStrap({
  onHr: (bpm) => { live.hr = bpm; live.hrSource = 'strap'; },
  onRr: addRr,
  onStatus: (state, name) => {
    if (state === 'ready') setPill('pillHr', 'ready', `HRM: ${name || 'connected'}`);
    else { live.hr = null; live.hrSource = null; setPill('pillHr', 'error', 'HRM: disconnected'); }
  },
});
$('pillIntervals').onclick = () => showTab('profile');
$('pillHr').onclick = async () => {
  if ($('pillHr').dataset.state === 'ready' || $('pillHr').dataset.state === 'busy') return;
  try {
    setPill('pillHr', 'busy', 'HRM: connecting…');
    await hrStrap.connect();
  } catch (err) {
    log('error', `HRM: ${err.message}`);
    setPill('pillHr', 'error', 'HRM: error');
  }
};

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
  try { localStorage.setItem('treadwise.tab', name); } catch { /* optional */ }
  // The chart measures its width when shown
  if (name === 'train') updateChart();
  if (name === 'workouts') preview.update({ plan: planTimeline(true), samples: [], elapsed: 0, zones });
}
for (const t of TABS) $(`nav-${t}`).onclick = () => showTab(t);

// ---------------------------------------------------------------------------
// Profile: threshold, LTHR and max HR (from Intervals.icu or by hand)
// ---------------------------------------------------------------------------
let profile = null;  // see zones.js
let zones = null;    // zones computed from the profile

function setProfile(p, { save = true } = {}) {
  profile = p;
  zones = zonesFromProfile(p);
  if (save) {
    try { localStorage.setItem('treadwise.profile', JSON.stringify(p)); } catch { /* optional */ }
  }
  renderProfile();
  selectWorkout(selectedKey); // recomputes speeds and HR caps
}

async function loadProfileFromIntervals() {
  $('pUserNote').textContent = 'Loading zones from Intervals.icu…';
  try {
    setProfile(profileFromIntervals(await intervals.getRunSettings()));
    $('pUserNote').textContent = '';
    log('info', `Intervals.icu profile: threshold ${formatPace(zones.thresholdKmh)}/km, LTHR ${zones.lthr}, max HR ${zones.maxHr}`);
  } catch (err) {
    $('pUserNote').textContent = `Could not read the zones: ${err.message}`;
    log('warn', `Intervals.icu zones: ${err.message}`);
  }
}

// Intervals.icu account (name, photo…), stored so it is not fetched on every visit
let athlete = null;
try { athlete = JSON.parse(localStorage.getItem('treadwise.athlete') || 'null'); } catch { /* optional */ }

function setAthlete(a) {
  athlete = a;
  try {
    if (a) localStorage.setItem('treadwise.athlete', JSON.stringify(a));
    else localStorage.removeItem('treadwise.athlete');
  } catch { /* optional */ }
  renderProfile();
}

function saveManualProfile() {
  const kmh = parsePace($('pPace').value);
  const lthr = parseInt($('pLthr').value, 10) || null;
  const maxHr = parseInt($('pMaxHr').value, 10) || null;
  if ($('pPace').value && !kmh) {
    $('pNote').textContent = 'Enter threshold pace as mm:ss, for example 6:10.';
    return;
  }
  const base = profile || { pacePct: DEFAULT_PACE_PCT, hrPct: DEFAULT_HR_PCT };
  setProfile({ ...base, thresholdKmh: kmh, lthr, maxHr, source: 'manual' });
  log('info', `Manual profile: threshold ${kmh ? `${formatPace(kmh)}/km` : '—'}, LTHR ${lthr ?? '—'}, max HR ${maxHr ?? '—'}`);
}

/** "6:10" → km/h */
function parsePace(text) {
  const m = String(text).trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return sec >= 120 && sec <= 1800 ? Math.round((3600 / sec) * 100) / 100 : null;
}

function renderProfile() {
  const loggedIn = !!intervals.getApiKey();
  $('pUser').classList.toggle('hidden', !loggedIn);
  $('pLogin').classList.toggle('hidden', loggedIn);
  $('pZonesCard').classList.toggle('hidden', !zones?.hr.length && !zones?.pace.length);

  // Logged out: the manual form, with the current data
  $('pPace').value = zones?.thresholdKmh ? formatPace(zones.thresholdKmh) : '';
  $('pLthr').value = profile?.lthr ?? '';
  $('pMaxHr').value = profile?.maxHr ?? '';
  const src = { intervals: 'Data from Intervals.icu', manual: 'Data entered by hand' }[profile?.source] || 'No data yet';
  const derived = [];
  if (profile && !profile.lthr && zones?.lthr) derived.push(`Estimated LTHR ${zones.lthr} (91 % of max HR)`);
  if (profile && !profile.maxHr && zones?.maxHr) derived.push(`Estimated max HR ${zones.maxHr}`);
  $('pNote').textContent = [src, ...derived].join(' · ');

  // Logged in: the account and its data
  if (loggedIn) {
    const name = athlete?.name || 'Intervals.icu';
    $('pName').textContent = name;
    $('pInitials').textContent = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const img = $('pAvatar');
    img.classList.toggle('hidden', !athlete?.photo);
    if (athlete?.photo && img.src !== athlete.photo) {
      img.onerror = () => img.classList.add('hidden');
      img.src = athlete.photo;
    }
    $('pMeta').textContent = [athlete?.id, [athlete?.city, athlete?.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    const stats = [
      ['Threshold pace', zones?.thresholdKmh ? formatPace(zones.thresholdKmh) : null, '/km'],
      ['LTHR', zones?.lthr, 'bpm'],
      ['Max HR', zones?.maxHr, 'bpm'],
      ['Resting HR', athlete?.restingHr, 'bpm'],
      ['Weight', athlete?.weight ? athlete.weight.toFixed(1) : null, 'kg'],
    ];
    $('pStats').replaceChildren(...stats.map(([label, value, unit]) => {
      const div = document.createElement('div');
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('strong');
      v.textContent = value ?? '—';
      if (value != null) {
        const u = document.createElement('small');
        u.textContent = ` ${unit}`;
        v.appendChild(u);
      }
      div.append(l, v);
      return div;
    }));
  }

  renderZoneTable();
  renderZones($('wZones'));
}

/** Profile zone table: HR and pace side by side. */
function renderZoneTable() {
  const rows = [];
  const n = Math.max(zones?.hr.length || 0, zones?.pace.length || 0);
  for (let i = 0; i < n; i++) {
    const h = zones.hr[i];
    const p = zones.pace[i];
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    const sw = document.createElement('i');
    sw.style.background = `var(--zone-${Math.min(7, i + 1)})`;
    name.append(sw, `Z${i + 1}`);
    const hr = document.createElement('td');
    hr.textContent = h ? (h.lo ? `${h.lo}–${h.hi}` : `≤ ${h.hi}`) : '—';
    const pace = document.createElement('td');
    pace.textContent = p
      ? (!p.lo ? `slower than ${formatPace(p.hi)}` : Number.isFinite(p.hi) ? `${formatPace(p.hi)}–${formatPace(p.lo)}` : `faster than ${formatPace(p.lo)}`)
      : '—';
    tr.append(name, hr, pace);
    rows.push(tr);
  }
  $('pZones').replaceChildren(...rows);
}

function renderZones(box) {
  box.replaceChildren();
  if (!zones) return;
  const row = (title, items) => {
    if (!items.length) return;
    const div = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = title;
    div.appendChild(b);
    for (const [z, text] of items) {
      const span = document.createElement('span');
      const sw = document.createElement('i');
      sw.style.background = `var(--zone-${Math.min(7, z)})`;
      span.append(sw, `Z${z} ${text}`);
      div.appendChild(span);
    }
    box.appendChild(div);
  };
  row('HR', zones.hr.map((h) => [h.z, h.lo ? `${h.lo}–${h.hi}` : `≤${h.hi}`]));
  row('Pace', zones.pace.map((p) => [p.z,
    !p.lo ? `>${formatPace(p.hi)}` : Number.isFinite(p.hi) ? `${formatPace(p.hi)}–${formatPace(p.lo)}` : `<${formatPace(p.lo)}`]));
}


function renderKeyState(text) {
  $('pKeyNote').textContent = text ?? '';
}

async function refreshAthlete() {
  const a = await intervals.getAthlete();
  setAthlete(a);
  return a;
}

$('pKeySave').onclick = async () => {
  const key = $('pKey').value.trim();
  if (!key) return;
  intervals.setApiKey(key);
  renderKeyState('Checking…');
  try {
    const a = await intervals.getAthlete();
    $('pKey').value = '';
    renderKeyState();
    setAthlete(a);
    log('info', `Intervals.icu: signed in as ${a.name}`);
    loadWorkouts();
    loadProfileFromIntervals(); // the account wins: replaces the profile, even a manual one
  } catch (err) {
    intervals.setApiKey(''); // a key that does not work does not sign in
    renderKeyState(`That didn't work: ${err.message}`);
  }
};

$('pRefresh').onclick = async () => {
  try {
    await refreshAthlete();
    await loadProfileFromIntervals();
    loadWorkouts();
  } catch (err) {
    $('pUserNote').textContent = `Could not refresh: ${err.message}`;
  }
};

$('pLogout').onclick = () => {
  intervals.setApiKey('');
  setAthlete(null);
  // The data stays as a starting point for the manual profile
  if (profile) setProfile({ ...profile, source: 'manual' });
  log('info', 'Intervals.icu: signed out');
  loadWorkouts();
};
$('pSave').onclick = saveManualProfile;

// ---------------------------------------------------------------------------
// Workouts: planned in Intervals.icu and library
// ---------------------------------------------------------------------------
let workouts = null;       // planned in Intervals.icu (null = not loaded)
let selected = null;       // { event, steps }
let selectedKey = 'none';  // 'none' | 'i:<index>' | 'l:<id>'

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

async function loadWorkouts() {
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

function workoutItem(key, title, sub) {
  const btn = document.createElement('button');
  btn.className = 'witem';
  btn.dataset.key = key;
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = sub;
  btn.append(strong, span);
  btn.onclick = () => selectWorkout(key);
  return btn;
}

/** Approximate total duration of a workout_doc (s). */
function docSeconds(doc) {
  const walk = (steps) => steps.reduce((a, s) => a + (s.steps ? (s.reps || 1) * walk(s.steps) : s.duration || 0), 0);
  return walk(doc?.steps || []);
}

// Library (library.json): loaded at startup
let LIBRARY = [];
let libTypes = [];
let libDurations = [30, 45, 60];
let libError = null;
let libFilter = { minutes: 45, type: 'all', level: 'all' };
try { libFilter = { ...libFilter, ...JSON.parse(localStorage.getItem('treadwise.libFilter') || '{}') }; } catch { /* optional */ }

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
      try { localStorage.setItem('treadwise.libFilter', JSON.stringify(libFilter)); } catch { /* optional */ }
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
      planned.appendChild(workoutItem(`i:${i}`, w.name || 'Workout', sec ? `~${formatDuration(sec)}` : ''));
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
    const item = workoutItem(`l:${w.id}`, w.featured ? `★ ${w.name} · ${w.minutes} min` : w.name, w.summary);
    lib.appendChild(item);
  }
  if (LIBRARY.length && !shown.length) lib.appendChild(listNote('No workouts match those filters.'));
  $('wLibCount').textContent = LIBRARY.length ? `${shown.length} of ${LIBRARY.length}` : '';
  markSelected();
}

function markSelected() {
  document.querySelectorAll('.witem').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === selectedKey)));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function selectWorkout(key = selectedKey) {
  if (['armed', 'running', 'paused'].includes(session.state)) return;
  // The library is not loaded yet: keep the choice and apply it on load
  if (key.startsWith('l:') && !LIBRARY.length && !libError) { selectedKey = key; return; }
  let event = null;
  if (key.startsWith('i:')) event = workouts?.[Number(key.slice(2))] || null;
  if (key.startsWith('l:')) {
    const w = LIBRARY.find((x) => x.id === key.slice(2));
    if (w) event = { name: w.name, description: w.description, workout_doc: w.workout_doc, library: true };
  }
  selectedKey = event ? key : 'none';
  if (event) {
    const needsProfile = event.library && !zones?.thresholdKmh;
    const steps = flattenWorkout(resolveDoc(event.workout_doc, zones), {
      position: $('wPosition').value,
      defaultIncline: parseFloat($('wIncline').value) || 0,
      zones,
    });
    selected = { event, steps, needsProfile };
  } else {
    selected = null;
  }
  try { localStorage.setItem('treadwise.workout', selectedKey.startsWith('l:') ? selectedKey : ''); } catch { /* optional */ }
  markSelected();
  renderWorkout();
  render();
  updateChart();
  updateControls();
  preview.update({ plan: planTimeline(true), samples: [], elapsed: 0, zones });
}

function renderWorkout() {
  const body = $('wSteps');
  if (!selected) {
    body.innerHTML = '';
    $('wName').textContent = 'No workout: manual control';
    $('wDesc').textContent = 'On the Train tab you set speed and incline with the buttons.';
    $('wTotal').textContent = '';
    return;
  }
  $('wName').textContent = selected.event.name || 'Workout';
  $('wDesc').textContent = (selected.needsProfile ? 'Threshold pace is missing in Profile: without it, steps have no speed.\n' : '') +
    (selected.event.description || '');
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
    adjust: 0, hrAdjust: 0, hrOutSince: null, hrWantDir: 0, hrLastAdjust: null, alphaLowSince: null, warmupHrSince: null, target: null, stopSince: null, samples: [], lastSampleAt: 0, startedAt: null, event: null, lastBeep: null,
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
  session.hrOutSince = null;
  session.hrWantDir = 0;
  session.hrLastAdjust = null;
  session.warmupHrSince = null;
  session.lastBeep = null;
  const step = currentStep();
  if (!step) {
    finish('Workout complete. Belt paused: finish or resume from the console.');
    treadmill?.pause();
    return;
  }
  log('info', `Step ${i + 1}/${session.steps.length}: ${step.label}`);
  beep(i === 0 ? 660 : 880, 0.25);
  treadmill?.setIncline(step.incline);
  pushTarget(true);
  highlightSteps();
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
      if (step) { treadmill?.setIncline(step.incline); pushTarget(true); }
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
    if (step) { treadmill?.setIncline(step.incline); pushTarget(true); }
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
      if (stepProgress(step) >= 1) applyStep(session.stepIdx + 1);
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
 */
function warmupDone(step) {
  if (!step.warmup || !step.ramp || !zones?.hr.length || !live.hr) return false;
  if (live.hr < zones.hr[0].hi) { session.warmupHrSince = null; return false; }
  session.warmupHrSince ??= session.stepElapsed;
  return session.stepElapsed - session.warmupHrSince >= WARMUP_HOLD_S;
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
 * in hrcontrol.js).
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
  if (!$('wHrAdjust').checked || !step.hr || step.hr.mode === 'info' || !step.hasTarget || !live.hr) return;
  const t = session.stepElapsed;
  if (t < HR_GRACE_S) return;
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
  if (session.hrLastAdjust != null && t - session.hrLastAdjust < HR_SPACING_S) return;
  const maxUp = mode === 'target' ? HR_MAX_UP : 0;
  const next = Math.round(Math.min(maxUp, Math.max(-HR_MAX_DOWN, session.hrAdjust + delta)) * 10) / 10;
  if (next === session.hrAdjust) return;
  const applied = Math.round((next - session.hrAdjust) * 10) / 10;
  session.hrAdjust = next;
  session.hrLastAdjust = t;
  session.hrOutSince = null;
  session.hrWantDir = 0;
  log('info', `${reason}: speed ${applied > 0 ? '+' : '−'}${Math.abs(applied).toFixed(1)} km/h, HR adjustment ${next > 0 ? '+' : ''}${next.toFixed(1)}`);
  pushTarget();
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
  download(`treadwise-${new Date(session.startedAt).toISOString().slice(0, 16).replace(':', '')}.csv`, samplesToCsv(session.samples), 'text/csv');
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

function updateControls() {
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
  $('wPosition').disabled = $('wIncline').disabled = active;
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
  download(`treadwise-${new Date(session.startedAt).toISOString().slice(0, 16).replace(':', '')}.tcx`, tcx, 'application/vnd.garmin.tcx+xml');
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
      description: `NordicTrack EXP 5i controlled by Treadwise. Base incline ${$('wIncline').value}%. Pace ${$('wPosition').selectedOptions[0].text.toLowerCase()} within the zone.`,
      external_id: `treadwise-${session.startedAt}`,
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

$('btnLogDownload').onclick = () => download(`treadwise-log-${Date.now()}.txt`, logLines.join('\n'), 'text/plain');

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Browser utilities
// ---------------------------------------------------------------------------
let audioCtx = null;
function beep(freq, seconds) {
  try {
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + seconds);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + seconds);
  } catch { /* no audio */ }
}

// Keeps the screen on from Start until the session ends. The browser drops
// the lock whenever the page is hidden (another app, notification shade,
// screen off), so it is requested again each time the page becomes visible.
let wakeLock = null;
let wakeWanted = false;
let wakeError = null;   // why the screen may still lock, shown under the controls
async function requestWakeLock() {
  wakeWanted = true;
  if (wakeLock || document.visibilityState !== 'visible') return;
  if (!navigator.wakeLock) {
    wakeError = 'This browser cannot keep the screen on: turn off auto-lock in the device settings.';
    updateControls();
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeError = null;
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) {
    // Usually battery saver mode
    wakeError = 'The screen may lock (battery saver?): turn off auto-lock or battery saver.';
    log('warn', `Wake lock: ${err.message}`);
  }
  updateControls();
}
function releaseWakeLock() {
  wakeWanted = false;
  wakeError = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (wakeWanted && document.visibilityState === 'visible') requestWakeLock();
});

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
// Treadmill state (what the console reports)
// ---------------------------------------------------------------------------
let lastMode;
function renderConsole() {
  const c = live.console;
  const fresh = treadmill && Date.now() - (treadmill.state.updatedAt || 0) < STALE_MS;
  const modeEl = $('cMode');
  const mode = fresh ? c.mode : undefined;
  modeEl.textContent = mode != null ? MODES[mode] || `mode ${mode}` : '—';
  modeEl.dataset.mode = mode ?? '';
  if (mode !== lastMode) {
    lastMode = mode;
    updateControls(); // the safety key notice depends on the mode
  }
  const set = (id, text) => { $(id).textContent = fresh && text != null ? text : '—'; };
  set('cSpeed', c.speed != null ? `${c.speed.toFixed(1)} km/h${c.speedSource === 'requested' ? ' (no actual reading)' : ''}` : null);
  set('cTarget', c.targetSpeed != null ? `${c.targetSpeed.toFixed(1)} km/h` : null);
  set('cIncline', c.incline != null ? `${c.incline.toFixed(1)} %` : null);
  set('cDist', c.distance != null ? `${(c.distance / 1000).toFixed(2)} km` : null);
  set('cTime', c.time != null ? formatDuration(c.time) : null);
  set('cCal', c.calories != null ? `${Math.round(c.calories)} kcal` : null);
  set('cPulse', c.pulse
    ? (c.pulse.bpm > 0 ? `${c.pulse.bpm} bpm · ${PULSE_SOURCES[c.pulse.source] || `source ${c.pulse.source}`}` : 'no pulse')
    : null);
}

function renderInfo() {
  const i = live.info;
  const parts = [];
  if (i.firmware) parts.push(`Firmware ${i.firmware}`);
  if (i.serial) parts.push(`Serial ${i.serial}`);
  if (i.reference) parts.push(`Model ${i.reference}`);
  if (i.supported) parts.push(`${i.supported.length} supported fields`);
  if (i.limits?.minKph != null) parts.push(`Speed ${i.limits.minKph}–${i.limits.maxKph} km/h`);
  if (i.limits?.maxIncline != null) parts.push(`Incline ${i.limits.minIncline}–${i.limits.maxIncline} %`);
  $('cInfo').textContent = parts.join(' · ') || 'No equipment info yet.';
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
{
  let saved = null;
  let tab = null;
  try {
    saved = JSON.parse(localStorage.getItem('treadwise.profile') || 'null');
    tab = localStorage.getItem('treadwise.tab');
    const w = localStorage.getItem('treadwise.workout');
    if (w?.startsWith('l:')) selectedKey = w; // confirmed once the library loads
  } catch { /* optional */ }
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
  try { sessionStorage.removeItem('treadwise.loadRetry'); } catch { /* optional */ }
}
