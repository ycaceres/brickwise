/**
 * Intervals.icu client running in the browser, with no backend of our own.
 *
 * The Intervals.icu API accepts cross-origin requests (CORS) with an
 * Authorization header, so the page calls it directly. The athlete types the
 * API key in Profile and it is stored only in their browser. Athlete "0" is
 * the key's owner, so their ID is not needed.
 */

const API = 'https://intervals.icu/api/v1/athlete/0';
const KEY_STORAGE = 'brickwise.intervalsKey';
const RUN_TYPES = new Set(['Run', 'VirtualRun', 'TrailRun']);

export function getApiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}

export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch { /* no storage: the key lasts only for this visit */ }
  memoryKey = key;
}

let memoryKey = getApiKey();

async function request(path, { method = 'GET', query, body } = {}) {
  if (!memoryKey) throw new Error('missing Intervals.icu API key (Profile tab)');
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    body,
    headers: { Authorization: `Basic ${btoa(`API_KEY:${memoryKey}`)}` },
  });
  if (res.status === 401 || res.status === 403) throw new Error('Intervals.icu rejected the API key');
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

/** Basic athlete data; also used to check the key. */
export async function getAthlete() {
  const a = await request('');
  return {
    id: a.id,
    name: a.name || [a.firstname, a.lastname].filter(Boolean).join(' '),
    photo: a.profile_medium || null,
    city: a.city || null,
    country: a.country || null,
    weight: a.icu_weight || null,
    restingHr: a.icu_resting_hr || null,
  };
}

/** Planned runs between two dates (YYYY-MM-DD), with resolved steps. */
export async function getWorkouts(oldest, newest) {
  const events = await request('/events', { query: { oldest, newest, category: 'WORKOUT', resolve: 'true' } });
  return (events || [])
    .filter((e) => RUN_TYPES.has(e.type) && e.workout_doc?.steps?.length)
    .map(({ id, name, start_date_local, type, description, workout_doc }) =>
      ({ id, name, start_date_local, type, description, workout_doc }));
}

/** Running HR and pace zones (Run sport-settings). */
export async function getRunSettings() {
  const settings = await request('/sport-settings');
  const run = (settings || []).find((s) => (s.types || []).some((t) => RUN_TYPES.has(t)));
  if (!run) throw new Error('no running zones in Intervals.icu');
  const keys = ['lthr', 'max_hr', 'hr_zones', 'hr_zone_names', 'threshold_pace', 'pace_zones', 'pace_zone_names'];
  return Object.fromEntries(keys.map((k) => [k, run[k]]));
}

/** Uploads a TCX as an activity. `meta`: name, description, external_id, paired_event_id. */
export async function uploadTcx(tcx, meta) {
  const form = new FormData();
  form.append('file', new Blob([tcx], { type: 'application/vnd.garmin.tcx+xml' }), 'brickwise.tcx');
  return request('/activities', {
    method: 'POST',
    query: { ...meta, device_name: 'NordicTrack EXP 5i' },
    body: form,
  });
}
