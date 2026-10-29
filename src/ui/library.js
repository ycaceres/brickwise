/**
 * Training library: data/library.json adapted to the profile, with duration,
 * type and level filters.
 */

import { $ } from '../lib/dom.js';
import * as settings from '../lib/settings.js';
import * as app from '../state.js';
import { loadLibrary } from '../workouts/library.js';
import { log } from './debug.js';
import { selectedKey, selectWorkout } from './selection.js';

let libTypes = [];
let libDurations = [30, 45, 60];
let libError = null;
let libFilter = { minutes: 45, type: 'all', level: 'all' };

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
      renderLibrary();
    };
    wrap.appendChild(sel);
    box.appendChild(wrap);
  };
  select('Duration', 'minutes', [['all', 'All'], ...libDurations.map((m) => [m, `${m} min`])]);
  select('Type', 'type', [['all', 'All'], ...libTypes.map((t) => [t.id, t.name])]);
  select('Level', 'level', [['all', 'All'], ...[1, 2, 3, 4, 5].map((n) => [n, String(n)])]);
}

function renderLibrary() {
  const library = app.state.library.entries;
  renderFilters();
  const entries = [{ key: 'none', title: 'No workout', sub: 'Manual speed and incline control' }];
  if (libError) entries.push({ note: `Could not load the library: ${libError}` });
  else if (!library.length) entries.push({ note: 'Loading library…' });
  const shown = library.filter(libraryMatches);
  for (const w of shown) {
    entries.push({ key: `l:${w.id}`, title: w.featured ? `★ ${w.name} · ${w.minutes} min` : w.name, sub: w.summary, hrControl: w.hrControl });
  }
  if (library.length && !shown.length) entries.push({ note: 'No workouts match those filters.' });
  $('wLibrary').entries = entries;
  $('wLibCount').textContent = library.length ? `${shown.length} of ${library.length}` : '';
}

/** Startup: the filters, then the library itself (picks the saved workout once loaded). */
export function initLibrary() {
  libFilter = { ...libFilter, ...settings.get('libFilter') };
  renderLibrary();
  loadLibrary().then((lib) => {
    libTypes = lib.types;
    libDurations = lib.durations;
    app.setLibrary(lib.entries);
    log('info', `Library: ${lib.entries.length} workouts`);
  }).catch((err) => {
    libError = err.message;
    app.setLibrary([]);
    log('error', `Library: ${err.message}`);
  }).finally(() => {
    renderLibrary();
    selectWorkout(selectedKey);
  });
}
