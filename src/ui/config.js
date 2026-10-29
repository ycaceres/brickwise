/**
 * Configuration tab: color palette and language, kept in localStorage
 * (brickwise.theme, brickwise.lang). The palette is also applied by the
 * inline script in index.html before the page paints, to avoid a flash.
 */
import { $ } from '../lib/dom.js';
import * as settings from '../lib/settings.js';
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
  for (const { code, native } of LANGUAGES) lang.add(new Option(native, code));
  theme.value = applyTheme(settings.get('theme'));
  setLanguage(settings.get('lang') ?? DEFAULT_LANGUAGE).then((code) => { lang.value = code; });
  theme.onchange = () => settings.set('theme', applyTheme(theme.value));
  lang.onchange = async () => settings.set('lang', await setLanguage(lang.value));
}
