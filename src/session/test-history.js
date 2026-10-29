/**
 * History of α1 threshold tests (newest first), kept in the "tests" setting,
 * and how a result reads. No DOM: the session saves results here and
 * Profile shows them.
 */
import * as settings from '../lib/settings.js';
import { formatPace } from '../workouts/steps.js';

export const TESTS_KEPT = 20;

export function loadTests() {
  return settings.get('tests');
}

/** Adds a result (from physiology/thresholds.js analyzeRamp) and returns the history. */
export function addTest(result, date = new Date()) {
  const tests = [{ date: date.toISOString(), ...result }, ...loadTests()].slice(0, TESTS_KEPT);
  settings.set('tests', tests);
  return tests;
}

export const vtText = (vt) => `${vt.hr} bpm at ${formatPace(vt.kmh)}/km`;
export const testText = (r) => `VT1 ${vtText(r.vt1)} · VT2 ${r.vt2 ? `${vtText(r.vt2)}${r.vt2.extrapolated ? ' (extrapolated)' : ''}` : 'not reached'}`;
