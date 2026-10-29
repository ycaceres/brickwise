/**
 * The interface languages. English is the source and the fallback; the
 * others load only when chosen. Adding one = a dictionary file next to
 * en.js and one entry here (see README.md).
 */
export const DEFAULT_LANGUAGE = 'en';

export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', dir: 'ltr', load: () => import('./en.js') },
  { code: 'es', name: 'Spanish', native: 'Español', dir: 'ltr', load: () => import('./es.js') },
];
