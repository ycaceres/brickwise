/**
 * Run tab: the live numbers (pace, incline, distance, time, HR, α1), the
 * session buttons, the chart, and export or upload when the session ends.
 */

import { $, download } from '../lib/dom.js';
import { formatPace, formatDuration } from '../workouts/steps.js';
import { LIMITS } from '../devices/treadmill/exp5i-protocol.js';
import { MODE } from '../devices/treadmill/ifit-messages.js';
import { hrZoneOf } from '../physiology/zones.js';
import { alphaState, ALPHA_LABELS } from '../physiology/hrv.js';
import { buildTcx } from '../export/tcx.js';
import { samplesToCsv } from '../export/csv.js';
import * as intervals from '../services/intervals.js';
import { live, rrState, rrActive } from '../session/live.js';
import { session, resetSession, currentStep, applyStep, pushTarget, start, finish } from '../session/runner.js';
import { wakeError, releaseWakeLock } from '../session/wake-lock.js';
import { log, renderConsole } from './debug.js';
import * as app from '../state.js';

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

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
export function planTimeline(planOnly = false) {
  const active = !planOnly && session.state !== 'idle';
  const steps = active ? session.steps : app.state.selection?.steps || [];
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
      t0, t1, speedStart: step.speedStart, speedEnd: step.speedEnd, power: step.power, ramp: step.ramp, incline: step.incline,
      zone: step.zone, hr: step.hr, intensity: step.intensity,
    });
    t = t1;
  });
  return out;
}

export function updateChart() {
  const event = session.state !== 'idle' ? session.event : app.state.selection?.event;
  $('chart').update({ plan: planTimeline(), samples: session.samples, elapsed: session.totalElapsed, zones: app.zonesFor(event) });
  $('chart').heading = event?.name || 'Free session';
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function updateControls() {
  const connected = !!app.state.devices.controllable?.connected;
  const active = ['armed', 'running', 'paused'].includes(session.state);
  // Rides need the bike trainer, which is not supported yet
  const ride = app.state.selection?.event?.sport === 'ride';
  $('btnStart').disabled = !connected || active || ride;
  const startLabel = app.state.selection ? 'Start workout' : 'Start free session';
  $('btnStart').title = startLabel;
  $('btnStart').setAttribute('aria-label', startLabel);
  $('btnSkip').disabled = !(session.steps.length && (session.state === 'running' || session.state === 'paused'));
  $('btnFinish').disabled = !active;
  const finished = session.state === 'done' && session.samples.length > 0;
  $('btnExport').disabled = !finished;
  $('btnUpload').disabled = !(finished && session.samples.length > 10 && intervals.getApiKey() && !session.uploaded);
  $('btnUpload').title = intervals.getApiKey() ? 'Upload to Intervals.icu (when finished)' : 'Upload to Intervals.icu: sign in with your API key in Profile';
  $('wPosition').disabled = $('wIncline').disabled = $('wHrAdjust').disabled = active;
  for (const list of document.querySelectorAll('bw-workout-list')) list.disabled = active;
  document.querySelectorAll('[data-speed],[data-incline]').forEach((b) => { b.disabled = !connected; });

  const notes = {
    idle: connected ? 'Pick a workout (or none) and press Start.' : 'Connect a controllable to begin.',
    armed: 'Press START on the console. The workout begins as soon as the belt moves.',
    running: session.steps.length ? 'Workout in progress.' : 'Free session in progress.',
    paused: 'Paused: the belt is stopped. Press START on the console to continue.',
  };
  if (notes[session.state]) $('sessionNote').textContent = notes[session.state];
  if (wakeError && ['armed', 'running', 'paused'].includes(session.state)) {
    $('sessionNote').textContent += ` ${wakeError}`;
  }
  if (session.state === 'idle' && app.state.selection?.needsProfile) {
    $('sessionNote').textContent = 'Threshold pace is missing in Profile: without it, this workout has no speeds.';
  }
  if (session.state === 'idle' && ride) {
    $('sessionNote').textContent = 'This is a bike workout: it needs a bike trainer, which is not supported yet.';
  }
  if (connected && live.console.mode === MODE.MISSING_SAFETY_KEY) {
    $('sessionNote').textContent = 'Safety key missing: attach it to the console.';
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export function render() {
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
  const hz = hrZoneOf(app.state.zones, live.hr);
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

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
/** Startup: the session buttons, the speed and incline buttons, and export. */
export function initRun() {
  app.on('selection', () => {
    render();
    updateChart();
    updateControls();
  });
  $('tab-run').querySelectorAll('[data-speed]').forEach((btn) => {
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
        app.state.devices.controllable?.setSpeed(session.target);
      }
    };
  });

  $('tab-run').querySelectorAll('[data-incline]').forEach((btn) => {
    btn.onclick = () => app.state.devices.controllable?.setIncline(live.incline + parseFloat(btn.dataset.incline));
  });

  $('btnStart').onclick = start;
  $('btnSkip').onclick = () => {
    if (session.state === 'running' || session.state === 'paused') applyStep(session.stepIdx + 1);
  };
  $('btnFinish').onclick = () => {
    if (session.state === 'armed') { resetSession(); releaseWakeLock(); updateControls(); return; }
    finish('Session ended. Belt paused: finish or resume from the console.');
    app.state.devices.controllable?.pause();
  };

  $('btnCsv').onclick = () => {
    $('menuExport').hidePopover();
    if (!session.samples.length) return;
    download(`brickwise-${new Date(session.startedAt).toISOString().slice(0, 16).replace(':', '')}.csv`, samplesToCsv(session.samples), 'text/csv');
  };
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
}
