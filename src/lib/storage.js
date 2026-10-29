/**
 * Raw access to localStorage (or sessionStorage) under the brickwise.
 * prefix. Only lib/settings.js uses it: the rest of the app goes through the
 * settings list there. Every setting is optional: if storage is blocked
 * (private mode, policies) reads return the fallback and writes are skipped.
 */

const PREFIX = 'brickwise.';
const area = (store) => (store === 'session' ? sessionStorage : localStorage);

export function loadJson(key, fallback = null, store) {
  try { return JSON.parse(area(store).getItem(PREFIX + key)) ?? fallback; } catch { return fallback; }
}

export function saveJson(key, value, store) {
  try { area(store).setItem(PREFIX + key, JSON.stringify(value)); } catch { /* optional */ }
}

export function loadText(key, store) {
  try { return area(store).getItem(PREFIX + key); } catch { return null; }
}

export function saveText(key, text, store) {
  try { area(store).setItem(PREFIX + key, text); } catch { /* optional */ }
}

export function remove(key, store) {
  try { area(store).removeItem(PREFIX + key); } catch { /* optional */ }
}
