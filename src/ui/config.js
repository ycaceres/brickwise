/**
 * Configuration tab: color palette and language, kept in localStorage
 * (brickwise.theme, brickwise.lang). The palette is also applied by the
 * inline script in index.html before the page paints, to avoid a flash.
 */
import { $ } from '../lib/dom.js';
import { loadText, saveText } from '../lib/storage.js';
import { LANGUAGES, DEFAULT_LANGUAGE, setLanguage } from '../i18n/index.js';

export const THEMES = ['system', 'light', 'dark', 'monochrome', 'vivid'];

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'system';
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  return theme;
}

export function initConfig() {
  const theme = $('cfgTheme');
  const lang = $('cfgLang');
  for (const [code, { name }] of Object.entries(LANGUAGES)) lang.add(new Option(name, code));
  theme.value = applyTheme(loadText('theme') ?? 'system');
  lang.value = setLanguage(loadText('lang') ?? DEFAULT_LANGUAGE);
  theme.onchange = () => saveText('theme', applyTheme(theme.value));
  lang.onchange = () => saveText('lang', setLanguage(lang.value));
}
