/**
 * Which supported language the browser (and so usually the operating
 * system) asks for: the first preferred tag that matches exactly, or by its
 * base language (es-MX → es), else the fallback.
 */
export function pickLanguage(preferred, supported, fallback = 'en') {
  const lower = supported.map((s) => s.toLowerCase());
  for (const tag of preferred) {
    const t = String(tag).toLowerCase();
    const exact = lower.indexOf(t);
    if (exact >= 0) return supported[exact];
    const base = lower.indexOf(t.split('-')[0]);
    if (base >= 0) return supported[base];
  }
  return fallback;
}

/** The browser's preferred languages, most wanted first. */
export const browserLanguages = () => (navigator.languages?.length ? [...navigator.languages] : [navigator.language].filter(Boolean));
