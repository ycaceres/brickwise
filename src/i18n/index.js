/**
 * Interface text by language. Each language is a module of key → text; a key
 * missing from a language falls back to English. In the page, elements carry
 * data-i18n="key" (text) and data-i18n-label="key" (aria-label and title).
 */
import en from './en.js';

export const LANGUAGES = { en: { name: 'English', messages: en } };
export const DEFAULT_LANGUAGE = 'en';

let messages = en;

export function t(key, vars = {}) {
  const text = messages[key] ?? en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m));
}

export function setLanguage(lang, root = document) {
  if (!(lang in LANGUAGES)) lang = DEFAULT_LANGUAGE;
  messages = LANGUAGES[lang].messages;
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) { el.title = t(el.dataset.i18nLabel); el.setAttribute('aria-label', el.title); }
  return lang;
}
