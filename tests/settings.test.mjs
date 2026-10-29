import test from 'node:test';
import assert from 'node:assert/strict';
import * as settings from '../src/lib/settings.js';

/** A Storage stand-in: getItem/setItem/removeItem over a Map. */
function fakeStorage() {
  const m = new Map();
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function withStores(fn) {
  const local = fakeStorage();
  const session = fakeStorage();
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;
  try { fn(local, session); } finally { delete globalThis.localStorage; delete globalThis.sessionStorage; }
}

test('settings: json and text round-trip under the brickwise. prefix', () => withStores((local) => {
  settings.set('profile', { lthr: 168 });
  assert.deepEqual(settings.get('profile'), { lthr: 168 });
  assert.equal(local.getItem('brickwise.profile'), '{"lthr":168}');
  settings.set('tab', 'run');
  assert.equal(settings.get('tab'), 'run');
  settings.remove('tab');
  assert.equal(settings.get('tab'), null);
}));

test('settings: fallbacks when unset', () => withStores(() => {
  assert.deepEqual(settings.get('tests'), []);
  assert.deepEqual(settings.get('libFilter'), {});
  assert.equal(settings.get('homeSport'), 'all');
  assert.equal(settings.get('theme'), 'system');
  assert.equal(settings.get('athlete'), null);
}));

test('settings: session values go to sessionStorage', () => withStores((local, session) => {
  settings.set('loadRetry', 1);
  assert.equal(session.getItem('brickwise.loadRetry'), '1');
  assert.equal(local.getItem('brickwise.loadRetry'), null);
  settings.remove('loadRetry');
  assert.equal(session.map.size, 0);
}));

test('settings: an unknown name throws', () => withStores(() => {
  assert.throws(() => settings.get('tabs'), /unknown setting "tabs"/);
  assert.throws(() => settings.set('profil', {}), /unknown setting/);
}));

test('settings: blocked storage returns the fallback and skips writes', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    assert.equal(settings.get('theme'), 'system');
    assert.deepEqual(settings.get('tests'), []);
    assert.doesNotThrow(() => settings.set('tab', 'home'));
    assert.doesNotThrow(() => settings.remove('tab'));
  } finally {
    delete globalThis.localStorage;
  }
});

test('settings: the API key is marked secret', () => {
  assert.equal(settings.SETTINGS.intervalsKey.secret, true);
  assert.deepEqual(Object.keys(settings.SETTINGS).filter((k) => settings.SETTINGS[k].secret), ['intervalsKey']);
});
