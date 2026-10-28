/**
 * Profile tab: threshold pace, LTHR and max HR (from Intervals.icu or by
 * hand), the cycling zones (FTP, power and HR, from Intervals.icu), the
 * Intervals.icu account and the threshold test history.
 */

import { $ } from '../lib/dom.js';
import { loadJson, saveJson, remove } from '../lib/storage.js';
import { formatPace } from '../workouts/steps.js';
import { zonesFromProfile, profileFromIntervals, rideFromIntervals, DEFAULT_PACE_PCT, DEFAULT_HR_PCT } from '../physiology/zones.js';
import * as intervals from '../services/intervals.js';
import { log } from './debug.js';
import { selectWorkout, selectedKey, loadWorkouts } from './workouts.js';

let profile = null;  // see physiology/zones.js
export let zones = null;    // zones computed from the profile

export function setProfile(p, { save = true } = {}) {
  profile = p;
  zones = zonesFromProfile(p);
  if (save) saveJson('profile', p);
  renderProfile();
  selectWorkout(selectedKey); // recomputes speeds and HR caps
}

// The account card, in Home and Profile
const userCards = () => document.querySelectorAll('bw-user-card');

function setUserNote(text) {
  for (const card of userCards()) card.note = text;
}

export async function loadProfileFromIntervals() {
  setUserNote('Loading zones from Intervals.icu…');
  try {
    const { run, ride } = await intervals.getSportSettings();
    setProfile({ ...profileFromIntervals(run), ride: rideFromIntervals(ride) });
    setUserNote('');
    log('info', `Intervals.icu profile: threshold ${formatPace(zones.thresholdKmh)}/km, LTHR ${zones.lthr}, max HR ${zones.maxHr}`);
    log('info', zones.ride ? `Intervals.icu cycling: FTP ${zones.ride.ftp ?? '—'} W, LTHR ${zones.ride.lthr ?? '—'}, max HR ${zones.ride.maxHr ?? '—'}` : 'Intervals.icu: no cycling settings');
  } catch (err) {
    setUserNote(`Could not read the zones: ${err.message}`);
    log('warn', `Intervals.icu zones: ${err.message}`);
  }
}

// Intervals.icu account (name, photo…), stored so it is not fetched on every visit
export let athlete = loadJson('athlete');

function setAthlete(a) {
  athlete = a;
  if (a) saveJson('athlete', a);
  else remove('athlete');
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

export function renderProfile() {
  const loggedIn = !!intervals.getApiKey();
  for (const card of userCards()) card.classList.toggle('hidden', !loggedIn);
  $('pLogin').classList.toggle('hidden', loggedIn);
  $('hLogin').classList.toggle('hidden', loggedIn);
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
  if (loggedIn) for (const card of userCards()) card.data = { athlete, wellness };

  renderZoneTable();
  renderRideZones();
  renderTests();
}

/** "LTHR 168 bpm @ 6:10 min/km · max HR 185 bpm", skipping what is missing. */
function zoneSummary(lthr, at, maxHr) {
  const threshold = lthr ? `LTHR ${lthr} bpm${at ? ` @ ${at}` : ''}` : at ? `Threshold ${at}` : null;
  return [threshold, maxHr ? `max HR ${maxHr} bpm` : null].filter(Boolean).join(' · ');
}

/** Profile zone table: HR and pace side by side. */
function renderZoneTable() {
  $('pRunSummary').textContent = zoneSummary(zones?.lthr, zones?.thresholdKmh ? `${formatPace(zones.thresholdKmh)} min/km` : null, zones?.maxHr);
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

/** Profile: cycling zones, power and HR side by side. */
function renderRideZones() {
  const ride = zones?.ride;
  $('pRideCard').classList.toggle('hidden', !ride?.power.length && !ride?.hr.length);
  if (!ride) return;
  const rows = [];
  const n = Math.max(ride.power.length, ride.hr.length);
  for (let i = 0; i < n; i++) {
    const p = ride.power[i];
    const h = ride.hr[i];
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    const sw = document.createElement('i');
    sw.style.background = `var(--zone-${Math.min(7, i + 1)})`;
    name.append(sw, `Z${i + 1}`);
    name.title = p?.name || h?.name || '';
    const hr = document.createElement('td');
    hr.textContent = h ? (h.lo ? `${h.lo}–${h.hi}` : `≤ ${h.hi}`) : '—';
    const power = document.createElement('td');
    power.textContent = p ? (!p.lo ? `≤ ${p.hi}` : Number.isFinite(p.hi) ? `${p.lo}–${p.hi}` : `≥ ${p.lo}`) : '—';
    tr.append(name, hr, power);
    rows.push(tr);
  }
  $('pRideZones').replaceChildren(...rows);
  $('pRideSummary').textContent = zoneSummary(ride.lthr, ride.ftp ? `${ride.ftp} W` : null, ride.maxHr);
  const r = profile?.ride;
  $('pRideNote').textContent = r?.indoorFtp && r.indoorFtp !== r.ftp ? `Power from the indoor FTP (${r.indoorFtp} W; outdoor ${r.ftp ?? '—'} W).` : '';
}

function renderKeyState(text) {
  $('pKeyNote').textContent = text ?? '';
}

export async function refreshAthlete() {
  const a = await intervals.getAthlete();
  setAthlete(a);
  return a;
}

// Wellness (weight, resting HR, HRV, sleep): refreshed on every visit
let wellness = loadJson('wellness');
const WELLNESS_DAYS = 7;

export async function refreshWellness() {
  const day = (offset) => {
    const d = new Date(Date.now() - offset * 86400000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  wellness = await intervals.getWellness(day(WELLNESS_DAYS - 1), day(0));
  saveJson('wellness', wellness);
  renderProfile();
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
    refreshWellness().catch((err) => log('warn', `Intervals.icu wellness: ${err.message}`));
    log('info', `Intervals.icu: signed in as ${a.name}`);
    loadWorkouts();
    loadProfileFromIntervals(); // the account wins: replaces the profile, even a manual one
  } catch (err) {
    intervals.setApiKey(''); // a key that does not work does not sign in
    renderKeyState(`That didn't work: ${err.message}`);
  }
};

const refreshAll = async () => {
  try {
    await refreshAthlete();
    await refreshWellness();
    await loadProfileFromIntervals();
    loadWorkouts();
  } catch (err) {
    setUserNote(`Could not refresh: ${err.message}`);
  }
};

const signOut = () => {
  intervals.setApiKey('');
  setAthlete(null);
  wellness = null;
  remove('wellness');
  // The data stays as a starting point for the manual profile
  if (profile) setProfile({ ...profile, source: 'manual' });
  log('info', 'Intervals.icu: signed out');
  loadWorkouts();
};
document.addEventListener('bw-refresh', refreshAll);
document.addEventListener('bw-signout', signOut);
$('pSave').onclick = saveManualProfile;

// Threshold test history (the tests are run and analyzed in the session)
export function loadTests() {
  return loadJson('tests', []);
}


const vtText = (vt) => `${vt.hr} bpm at ${formatPace(vt.kmh)}/km`;
export const testText = (r) => `VT1 ${vtText(r.vt1)} · VT2 ${r.vt2 ? `${vtText(r.vt2)}${r.vt2.extrapolated ? ' (extrapolated)' : ''}` : 'not reached'}`;


/** Profile: threshold test history; the latest VT2 can become LTHR and threshold pace. */
export function renderTests() {
  const tests = loadTests();
  $('pTestsCard').classList.toggle('hidden', !tests.length);
  $('pTests').replaceChildren(...tests.map((t) => {
    const tr = document.createElement('tr');
    for (const v of [new Date(t.date).toLocaleDateString(), vtText(t.vt1), t.vt2 ? vtText(t.vt2) + (t.vt2.extrapolated ? ' *' : '') : '—', t.r2]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    return tr;
  }));
  const last = tests.find((t) => t.vt2);
  $('pTestApply').disabled = !last;
  $('pTestApply').textContent = last
    ? `Use VT2 as LTHR (${last.vt2.hr}) and threshold pace (${formatPace(last.vt2.kmh)}/km)`
    : 'Use VT2 as LTHR and threshold pace';
}


$('pTestApply').onclick = () => {
  const last = loadTests().find((t) => t.vt2);
  if (!last) return;
  const base = profile || { pacePct: DEFAULT_PACE_PCT, hrPct: DEFAULT_HR_PCT };
  setProfile({ ...base, thresholdKmh: last.vt2.kmh, lthr: last.vt2.hr, source: 'manual' });
  log('info', `Profile from the threshold test: LTHR ${last.vt2.hr}, threshold ${formatPace(last.vt2.kmh)}/km`);
};

