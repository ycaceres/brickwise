/**
 * Interface text by language. A language is a module of key → message;
 * a key missing from a language falls back to English, then to the key
 * itself. A message is a string with {name} placeholders, or a plural
 * object ({ one, other, … }) chosen by vars.n with Intl.PluralRules.
 *
 * In the page, elements carry data-i18n="key" (text), data-i18n-label="key"
 * (title and aria-label) and data-i18n-placeholder="key". setLanguage()
 * applies them and fires 'bw-language' on document, so code that builds
 * text in JS can redraw.
 */
import en from './en.js';
import { LANGUAGES, DEFAULT_LANGUAGE } from './languages.js';

export { LANGUAGES, DEFAULT_LANGUAGE };

const loaded = { en };
let current = DEFAULT_LANGUAGE;
let messages = en;

export const getLanguage = () => current;

/** The {placeholders} in a message (all forms of a plural). */
export function placeholders(message) {
  const texts = typeof message === 'string' ? [message] : Object.values(message ?? {});
  return [...new Set(texts.flatMap((s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
}

function pick(message, vars, lang) {
  if (message == null || typeof message === 'string') return message;
  const n = vars.n ?? vars.count;
  const form = n != null ? new Intl.PluralRules(lang).select(n) : 'other';
  return message[form] ?? message.other;
}

export function t(key, vars = {}) {
  const text = pick(messages[key], vars, current) ?? pick(en[key], vars, 'en') ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m));
}

/** Applies the data-i18n attributes inside root. */
export function translate(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) {
    el.title = t(el.dataset.i18nLabel);
    el.setAttribute('aria-label', el.title);
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
}

/** Loads a language (or English, if unknown), applies it to the page and tells the code. */
export async function setLanguage(code, root = document) {
  const lang = LANGUAGES.find((l) => l.code === code) ?? LANGUAGES.find((l) => l.code === DEFAULT_LANGUAGE);
  loaded[lang.code] ??= (await lang.load()).default;
  current = lang.code;
  messages = loaded[lang.code];
  document.documentElement.lang = lang.code;
  document.documentElement.dir = lang.dir ?? 'ltr';
  translate(root);
  document.dispatchEvent(new CustomEvent('bw-language', { detail: { lang: lang.code } }));
  return lang.code;
}

/** Keys of English a dictionary does not have (translation coverage). */
export const missingKeys = (dict) => Object.keys(en).filter((k) => !(k in dict));
