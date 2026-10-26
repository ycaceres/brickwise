/**
 * The app used to be called "EXP 5i" and stored its data under `exp5i.*`.
 * Copies those keys to `treadwise.*` once so nobody loses their API key,
 * profile or filters. Imported first, before any module reads storage.
 */
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('exp5i.')) continue;
    const next = `treadwise.${k.slice(6)}`;
    if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(k));
    localStorage.removeItem(k);
  }
} catch { /* no storage */ }
