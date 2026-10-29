/**
 * Runs a session: waits for the belt, walks the workout steps, sends speed
 * and incline, records a sample per second, adjusts by HR and α1, and
 * analyzes the threshold test when it ends.
 */

import { $ } from '../lib/dom.js';
import { saveJson } from '../lib/storage.js';
import { beep } from '../lib/sound.js';
import { LIMITS } from '../devices/treadmill/exp5i-protocol.js';
import { targetSpeedAt } from '../workouts/steps.js';
import { VT1, VT2 } from '../physiology/hrv.js';
import { analyzeRamp } from '../physiology/thresholds.js';
import { hrDecision, hrSlope, inclineStep, alphaGuardApplies, SLOPE_WINDOW_S, AEROBIC_AIM } from './hr-control.js';
import { live, rrState, rrActive, updateAlpha, STALE_MS } from './live.js';
import { requestWakeLock, releaseWakeLock } from './wake-lock.js';
import { log } from '../ui/debug.js';
import { treadmill } from '../ui/devices.js';
import { zones, loadTests, testText, renderTests } from '../ui/profile.js';
import { selected, highlightSteps } from '../ui/workouts.js';
import { render, updateChart, updateControls } from '../ui/run.js';

const MOVING_KMH = 0.5;      // above this the belt is moving
const AUTO_PAUSE_MS = 2000;  // belt stopped this long → pause

// Speed adjustment by HR (steps carry the HR range of their zones)
const HR_GRACE_S = 45;       // at the start of a step HR takes a while to respond
const HR_HOLD_S = 10;        // the same correction must be asked for this long in a row
const HR_SPACING_S = 25;     // between one adjustment and the next
const HR_RISE_SPACING_S = 60; // between two rises: HR answers a rise 1–2 min later (#10)
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

export const session = {
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
  hrLastRise: null,   // step s of the last HR adjustment that raised speed
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

export function resetSession() {
  Object.assign(session, {
    state: 'idle', steps: [], stepIdx: 0, stepElapsed: 0, stepDist: 0, totalElapsed: 0, totalDist: 0,
    adjust: 0, hrAdjust: 0, hrOutSince: null, hrWantDir: 0, hrOn: false, hrLastAdjust: null, hrLastRise: null, inclineAdjust: 0, testStart: null, testEnd: null, testLowSince: null, testMarks: {}, alphaLowSince: null, warmupHrSince: null, target: null, stopSince: null, samples: [], lastSampleAt: 0, startedAt: null, event: null, lastBeep: null,
    stepStarts: [], uploaded: false,
  });
}

export function currentStep() {
  return session.steps[session.stepIdx] || null;
}

function stepProgress(step) {
  if (!step) return 0;
  if (step.duration) return session.stepElapsed / step.duration;
  if (step.distance) return session.stepDist / step.distance;
  return 0;
}

export function applyStep(i) {
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
  session.hrLastRise = null;
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
export function pushTarget(force = false) {
  const step = currentStep();
  if (!step?.hasTarget) { session.target = null; return; }
  const base = targetSpeedAt(step, stepProgress(step));
  const t = Math.round(Math.min(LIMITS.speedMax, Math.max(LIMITS.speedMin, base + session.adjust + session.hrAdjust)) * 10) / 10;
  if (force || t !== session.target) {
    session.target = t;
    treadmill?.setSpeed(t);
  }
}

export function start() {
  resetSession();
  session.steps = selected ? selected.steps : [];
  session.event = selected ? selected.event : null;
  session.hrOn = !!selected?.hrOn;
  session.state = 'armed';
  requestWakeLock();
  updateControls();
  updateChart();
}

export function finish(message) {
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

export function tick() {
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
 *   of the range (lower on aerobic steps).
 * - Aerobic steps (Z1–Z2, past the warm-up, HR above Z1): speed also drops
 *   while α1 stays below VT1.
 * The same correction must be asked for HR_HOLD_S in a row, and at least
 * HR_SPACING_S pass between adjustments (HR_RISE_SPACING_S between rises),
 * because HR responds with a lag.
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
    alphaLow: low && alphaGuardApplies({ zone: step.zone, warmup: step.warmup, hr: live.hr, z1Top: zones?.hr[0]?.hi }),
    aim: mode === 'target' && step.zone != null && step.zone <= 2 ? AEROBIC_AIM : 0.5,
  });
  const dir = Math.sign(delta);
  if (!dir) { session.hrOutSince = null; session.hrWantDir = 0; return; }
  if (dir !== session.hrWantDir) { session.hrWantDir = dir; session.hrOutSince = t; }
  if (t - session.hrOutSince < HR_HOLD_S) return;
  const byIncline = step.hr.by === 'incline';
  if (session.hrLastAdjust != null && t - session.hrLastAdjust < (byIncline ? INCLINE_SPACING_S : HR_SPACING_S)) return;
  if (dir > 0 && session.hrLastRise != null && t - session.hrLastRise < HR_RISE_SPACING_S) return;
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
  if (dir > 0) session.hrLastRise = t;
  session.hrOutSince = null;
  session.hrWantDir = 0;
}

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
