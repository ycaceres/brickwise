/**
 * The page's settings in localStorage, under the brickwise. prefix. Every
 * setting is optional: if storage is blocked (private mode, policies) reads
 * return the fallback and writes are skipped.
 */

const PREFIX = 'brickwise.';

export function loadJson(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(PREFIX + key)) ?? fallback; } catch { return fallback; }
}

export function saveJson(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* optional */ }
}

export function loadText(key) {
  try { return localStorage.getItem(PREFIX + key); } catch { return null; }
}

export function saveText(key, text) {
  try { localStorage.setItem(PREFIX + key, text); } catch { /* optional */ }
}

export function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* optional */ }
}
