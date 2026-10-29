import test from 'node:test';
import assert from 'node:assert/strict';
import { workoutSeconds, hrControllable } from '../src/workouts/info.js';
import { zonesFromProfile, profileFromIntervals } from '../src/physiology/zones.js';
import { easyRun, runSettings } from './fixtures.mjs';

test('info: workoutSeconds counts repeats', () => {
  assert.equal(workoutSeconds(easyRun), 180 + 2 * (540 + 60) + 120);
  assert.equal(workoutSeconds({ steps: [{ reps: 3, steps: [{ duration: 60 }, { reps: 2, steps: [{ duration: 10 }] }] }] }), 3 * (60 + 20));
  assert.equal(workoutSeconds(null), 0);
});

test('info: hrControllable — library flag, rides, and runs judged by their steps', () => {
  const zones = zonesFromProfile(profileFromIntervals(runSettings));
  assert.equal(hrControllable({ hrControl: true, workout_doc: { steps: [] } }, zones), true);
  assert.equal(hrControllable({ hrControl: false, workout_doc: easyRun }, zones), false);
  assert.equal(hrControllable({ sport: 'ride', workout_doc: easyRun }, zones), false);
  // Easy Run 9+1: two 9′ Z2 steps, long enough for HR control
  assert.equal(hrControllable({ sport: 'run', workout_doc: easyRun }, zones), true);
  // Only short steps: nothing for HR to steer
  const short = { steps: [{ duration: 60, pace: { value: 2, units: 'pace_zone' }, _pace: { start: 2.09, end: 2.37 } }] };
  assert.equal(hrControllable({ sport: 'run', workout_doc: short }, zones), false);
});
