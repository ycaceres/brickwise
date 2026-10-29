/**
 * Workout page (no nav button: opened from a workout in Home or the
 * library): name, description, options, the steps table, totals and the
 * chart preview. It redraws on every new selection.
 */

import { $, escapeHtml } from '../lib/dom.js';
import * as app from '../state.js';
import { formatPace, formatDuration } from '../workouts/steps.js';
import { session } from '../session/runner.js';
import { planTimeline } from './run.js';

const STEP_HEADS = {
  run: ['#', 'Step', 'Dur.', 'km/h', 'Pace', '%'],
  ride: ['#', 'Step', 'Dur.', 'W', 'HR'],
};

function renderStepHead(sport) {
  const tr = document.createElement('tr');
  STEP_HEADS[sport].forEach((text, i) => {
    const th = document.createElement('th');
    th.textContent = text;
    if (i > 1) th.className = 'r';
    tr.appendChild(th);
  });
  $('wStepsHead').replaceChildren(tr);
}

function renderWorkout() {
  const sel = app.state.selection;
  const body = $('wSteps');
  const ride = sel?.event.sport === 'ride';
  $('wHrAdjustRow').hidden = !sel?.hrControl;
  $('wPosition').closest('label').hidden = $('wIncline').closest('label').hidden = ride;
  renderStepHead(ride ? 'ride' : 'run');
  if (!sel) {
    body.innerHTML = '';
    $('wName').textContent = $('wName').title = 'No workout: manual control';
    $('wDesc').textContent = 'On the Run tab you set speed and incline with the buttons.';
    $('wTotal').textContent = '';
    return;
  }
  $('wName').textContent = $('wName').title = sel.event.name || 'Workout'; // title: the full name when it is cut
  const missing = ride ? 'FTP is missing in Intervals.icu: without it, steps have no watts.\n' : 'Threshold pace is missing in Profile: without it, steps have no speed.\n';
  $('wDesc').textContent = (sel.needsProfile ? missing : '') +
    (sel.event.description || '') +
    (sel.hrOn ? '\n♥ Long steps follow their HR zone (speed starts at the planned pace); short ones keep their pace.' : '');
  if (ride) {
    body.innerHTML = sel.steps.map((s, i) => {
      const dur = s.duration ? formatDuration(s.duration) : s.distance ? `${(s.distance / 1000).toFixed(2)} km` : '—';
      const w = s.power ? (s.power.lo === s.power.hi ? s.power.lo : `${s.power.lo}–${s.power.hi}`) : '—';
      const hr = s.hr ? `${s.hr.lo}–${s.hr.hi}` : '—';
      return `<tr data-i="${i}"><td>${i + 1}</td><td>${escapeHtml(s.label)}</td><td class="r num">${dur}</td>` +
        `<td class="r num">${w}</td><td class="r num">${hr}</td></tr>`;
    }).join('');
    const sec = sel.steps.reduce((a, s) => a + (s.duration || 0), 0);
    $('wTotal').textContent = `${sel.steps.length} steps · ~${formatDuration(sec)}`;
    highlightSteps();
    return;
  }
  body.innerHTML = sel.steps.map((s, i) => {
    const dur = s.duration ? formatDuration(s.duration) : s.distance ? `${(s.distance / 1000).toFixed(2)} km` : '—';
    const spd = s.hasTarget ? (s.ramp ? `${s.speedStart}→${s.speedEnd}` : s.speedStart.toFixed(1)) : 'free';
    const pace = s.hasTarget ? (s.ramp ? `${formatPace(s.speedStart)}→${formatPace(s.speedEnd)}` : formatPace(s.speedStart)) : '—';
    return `<tr data-i="${i}"><td>${i + 1}</td><td>${escapeHtml(s.label)}</td><td class="r num">${dur}</td>` +
      `<td class="r num">${spd}</td><td class="r num">${pace}</td><td class="r num">${s.incline}</td></tr>`;
  }).join('');

  const totalSec = sel.steps.reduce((a, s) => a + (s.duration || (s.distance && s.speedStart ? s.distance / (s.speedStart / 3.6) : 0)), 0);
  const totalKm = sel.steps.reduce((a, s) => a + (s.distance || (s.duration && s.speedStart ? s.duration * ((s.speedStart + s.speedEnd) / 2) / 3.6 : 0)), 0) / 1000;
  $('wTotal').textContent = `${sel.steps.length} steps · ~${formatDuration(totalSec)} · ~${totalKm.toFixed(2)} km`;
  highlightSteps();
}

export function highlightSteps() {
  document.querySelectorAll('#wSteps tr').forEach((tr) => {
    const i = Number(tr.dataset.i);
    const active = session.state === 'running' || session.state === 'paused' || session.state === 'done';
    tr.classList.toggle('current', active && session.state !== 'done' && i === session.stepIdx);
    tr.classList.toggle('done', active && (i < session.stepIdx || session.state === 'done'));
  });
}

// The chosen workout's chart, on this page
export function updatePreview() {
  $('wPreview').update({ plan: planTimeline(true), samples: [], elapsed: 0, zones: app.zonesFor(app.state.selection?.event) });
}

const readOptions = () => ({
  position: $('wPosition').value,
  defaultIncline: parseFloat($('wIncline').value) || 0,
  hrAdjust: $('wHrAdjust').checked,
});

/** Startup: the options (pace in the zone, base incline, HR adjust) and the redraw on each selection. */
export function initWorkoutPage() {
  app.setWorkoutOptions(readOptions());
  for (const id of ['wPosition', 'wIncline', 'wHrAdjust']) $(id).onchange = () => app.setWorkoutOptions(readOptions());
  app.on('selection', () => {
    renderWorkout();
    updatePreview();
  });
}
