/** Small DOM helpers shared by the UI. */

export const $ = (id) => document.getElementById(id);

/** Status pill in the header: state (idle | busy | ready | error) and text. */
export function setPill(id, state, text) {
  const el = $(id);
  el.dataset.state = state;
  if (text) el.textContent = text;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Saves a text file through the browser's download. */
export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
