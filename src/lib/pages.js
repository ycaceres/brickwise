/**
 * The pages (pages/*.html), each a <div id="tab-…" class="tab">, loaded all
 * together at startup and put in <main> before the footer. The UI modules
 * wire them afterwards (their init functions).
 */

export const PAGE_FILES = ['home', 'config', 'profile', 'workouts', 'workout', 'run', 'ride', 'debug'];

export async function loadPages(main = document.querySelector('main')) {
  const html = await Promise.all(PAGE_FILES.map(async (name) => {
    // no-cache: revalidated on each visit, so the HTML never lags the code
    const res = await fetch(new URL(`../../pages/${name}.html`, import.meta.url), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`pages/${name}.html: HTTP ${res.status}`);
    return res.text();
  }));
  const tpl = document.createElement('template');
  tpl.innerHTML = html.join('\n');
  main.insertBefore(tpl.content, main.querySelector('footer'));
}
