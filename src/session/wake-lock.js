/** Screen Wake Lock for the length of a session. */

import { log } from '../ui/debug.js';
import { updateControls } from '../main.js';

// Keeps the screen on from Start until the session ends. The browser drops
// the lock whenever the page is hidden (another app, notification shade,
// screen off), so it is requested again each time the page becomes visible.
let wakeLock = null;
let wakeWanted = false;
export let wakeError = null;   // why the screen may still lock, shown under the controls
export async function requestWakeLock() {
  wakeWanted = true;
  if (wakeLock || document.visibilityState !== 'visible') return;
  if (!navigator.wakeLock) {
    wakeError = 'This browser cannot keep the screen on: turn off auto-lock in the device settings.';
    updateControls();
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
  updateControls();
}
export function releaseWakeLock() {
  wakeWanted = false;
  wakeError = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (wakeWanted && document.visibilityState === 'visible') requestWakeLock();
});

