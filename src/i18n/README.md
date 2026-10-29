# Interface languages

English (`en.js`) is the source and the fallback: every key exists there. Other languages are dictionaries with the same keys, loaded only when chosen.

## Adding a language

1. Copy `en.js` to `<code>.js` (e.g. `es.js`) and translate the values; keep the keys.
2. Register it in `languages.js`: `{ code: 'es', name: 'Spanish', native: 'Español', dir: 'ltr', load: () => import('./es.js') }`.
3. Run `npm test`: it checks that every key exists in English, that each message keeps the same `{placeholders}` and that plural messages have the forms the language needs. Missing keys are only a warning: English shows for them.
4. Look at every page in the language (desktop and mobile, the 5 palettes): longer words must not break the layout.

## Choosing the language

1. A language chosen in Configuration is saved (`brickwise.lang`) and always wins.
2. The default choice, **System**, follows the browser (which usually follows the operating system): `detect.js` walks `navigator.languages` and takes the first supported language, exactly or by its base language (`es-MX` → `es`, `fr-CA` → `fr`); with none, English. It follows the browser again when its language changes (`languagechange`).
3. Regional variants share their base dictionary.

## Keys and messages

- Keys are grouped by area: `nav.*`, `config.*`, `home.*`, `library.*`, `workout.*`, `run.*`, `ride.*`, `profile.*`, `chart.*`, `devices.*`, `common.*`.
- `{name}` placeholders are filled by `t(key, { name })`; keep them in every translation.
- Plurals: a message can be `{ one: '{n} step', other: '{n} steps' }` (add `zero`, `few`, `many` where the language uses them); `t(key, { n })` picks the form with `Intl.PluralRules`.
- In the HTML: `data-i18n="key"` (text), `data-i18n-label="key"` (title and aria-label), `data-i18n-placeholder="key"`. Code that builds text in JS uses `t()` and redraws on the `bw-language` event.
- Numbers and dates go through `format.js` (`formatNumber`, `formatDate`), which follow the language (7.5 / 7,5).

## What not to translate

- The Debug tab's device tables and every log line (Debug log, session and device logs): they are diagnostics, read in English in bug reports.
- The name and description of activities uploaded to Intervals.icu.

- Brand and product names (Brickwise, Intervals.icu, NordicTrack…), and names that come from Intervals.icu or the library (workout names and descriptions).
- Acronyms athletes use as they are: FTP, LTHR, HRV, DFA α1, VT1/VT2, ERG, TCX, CSV, HRM.
- Units are keys (`units.*`), so a language can decide spacing.

## Tone

Short, plain and direct, like the English: imperative for actions ("Connect treadmill"), no exclamation marks, the same term for the same thing everywhere (workout, step, zone, threshold).

## Spanish (`es.js`)

Neutral Spanish with Latin American terms.

| English | Español |
|---|---|
| treadmill | caminadora |
| smart trainer | rodillo inteligente |
| workout / step / zone | entrenamiento / paso / zona |
| threshold pace | ritmo umbral |
| HR / max HR / resting HR | FC / FC máx. / FC en reposo |
| warm-up / cooldown | calentamiento / vuelta a la calma |
| belt / safety key | banda / llave de seguridad |
| sign in / sign out | iniciar sesión / cerrar sesión |
| Run / Ride (tabs) | Correr / Bici |

Pill states avoid gender ("en línea", "sin conexión") because the same word follows "Caminadora" and "Rodillo".

## French (`fr.js`)

| English | Français |
|---|---|
| workout / step | séance / étape |
| Training library | Bibliothèque de séances |
| threshold pace | allure seuil |
| HR / max HR / resting HR | FC / FC max / FC au repos |
| warm-up / cooldown | échauffement / retour au calme |
| treadmill / smart trainer | tapis de course / home trainer connecté |
| belt / safety key | tapis / clé de sécurité |
| sign in / sign out | se connecter / se déconnecter |
| Run / Ride (tabs) | Course / Vélo |

Typography: narrow no-break space (U+202F) before `:` `;` `?` `!`, no-break space (U+00A0) before `%` and in "45 min"; typographic apostrophe `’`. FTP stays FTP (PMA is a different metric). In French 0 takes the singular ("0 étape").
