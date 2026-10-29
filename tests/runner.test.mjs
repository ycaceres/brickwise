import test from 'node:test';
import assert from 'node:assert/strict';

test('runner: loads in Node, with no window, document or AudioContext', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const runner = await import('../src/session/runner.js');
  assert.equal(typeof runner.tick, 'function');
  assert.equal(runner.session.state, 'idle');
});

test('runner: a short workout runs from the belt start to the end', async () => {
  const { session, events, start, tick } = await import('../src/session/runner.js');
  const { setDevice, setSelection } = await import('../src/state.js');
  const { live } = await import('../src/session/live.js');

  const sent = [];
  const device = {
    connected: true,
    state: { updatedAt: 0 },
    limits: { speedMin: 0.8, speedMax: 16, inclineMin: 0, inclineMax: 10 },
    setTarget: ({ speed, incline }) => {
      if (incline != null) sent.push(['incline', incline]);
      if (speed != null) sent.push(['speed', speed]);
    },
    pause: () => sent.push(['pause']),
  };
  setDevice('controllable', device);
  const step = (label, kmh, duration) => ({ label, duration, hasTarget: true, speedStart: kmh, speedEnd: kmh, incline: 1, hr: null });
  setSelection({ key: 'l:test', event: { name: 'Test' }, steps: [step('A', 8, 3), step('B', 9, 3)], hrOn: false });

  const seen = { change: 0, active: [], notes: [] };
  events.on('change', () => seen.change++);
  events.on('active', (on) => seen.active.push(on));
  events.on('note', ({ text }) => seen.notes.push(text));

  start();
  assert.equal(session.state, 'armed');
  assert.deepEqual(seen.active, [true]);

  // The belt starts: the first step's speed and incline go out
  let now = 10_000;
  const at = (t) => { device.state.updatedAt = t; live.speed = 8; tick(t); };
  at(now);
  assert.equal(session.state, 'running');
  assert.deepEqual(sent.slice(0, 2), [['incline', 1], ['speed', 8]]);

  // 3 s later the second step starts
  for (let i = 0; i < 4; i++) at((now += 1000));
  assert.equal(session.stepIdx, 1);
  assert.ok(sent.some(([k, v]) => k === 'speed' && v === 9));

  // And at its end the session is done and the belt pauses
  for (let i = 0; i < 4; i++) at((now += 1000));
  assert.equal(session.state, 'done');
  assert.deepEqual(sent.at(-1), ['pause']);
  assert.deepEqual(seen.active, [true, false]);
  assert.match(seen.notes.at(-1), /Workout complete/);
  assert.ok(seen.change >= 4);
  assert.ok(session.samples.length >= 7);
});
