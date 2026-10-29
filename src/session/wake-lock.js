/**
 * Screen Wake Lock for the length of a session. Keeps the screen on from
 * Start until the session ends. The browser drops the lock whenever the page
 * is hidden (another app, notification shade, screen off), so it is
 * requested again each time the page becomes visible. onChange is called when
 * wakeError (why the screen may still lock) changes.
 */

let wakeLock = null;
let wakeWanted = false;
let onChange = () => {};
let log = () => {};
export let wakeError = null;

export async function requestWakeLock() {
  wakeWanted = true;
  if (wakeLock || document.visibilityState !== 'visible') return;
  if (!navigator.wakeLock) {
    wakeError = 'This browser cannot keep the screen on: turn off auto-lock in the device settings.';
    onChange();
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeError = null;
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) {
    // Usually battery saver mode
    wakeError = 'The screen may lock (battery saver?): turn off auto-lock or battery saver.';
    log('warn', `Wake lock: ${err.message}`);
  }
  onChange();
}

export function releaseWakeLock() {
  wakeWanted = false;
  wakeError = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

/** Startup: where to report changes and problems; re-requests the lock when the page shows again. */
export function initWakeLock(hooks = {}) {
  onChange = hooks.onChange ?? onChange;
  log = hooks.log ?? log;
  document.addEventListener('visibilitychange', () => {
    if (wakeWanted && document.visibilityState === 'visible') requestWakeLock();
  });
}
